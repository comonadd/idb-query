import * as idb from "idb/with-async-ittr.js";
import {
  IDBPDatabase,
  IDBPIndex,
  IDBPObjectStore,
  IDBPCursorWithValueIteratorValue,
} from "idb";

export type DbHandle = IDBPDatabase<unknown>;

type GroupKey<T> = any;
type GroupBy<T> = (item: T) => GroupKey<T>;
type Group<T> = T[];
export type GroupedItems<T> = Map<GroupKey<T>, Group<T>>;
type GroupInt<T> = [GroupKey<T>, Group<T>];
type GroupFilter<T> = (groupKey: GroupKey<T>, groupItems: Group<T>) => boolean;
interface Query<T> {
  _state: {
    tx: IDBTransaction | null;
    store: IDBPObjectStore | null;
    filters: ((item: T) => boolean)[];
    groupFilters: GroupFilter<T>[];
    lowerBound: any | null;
    upperBound: any | null;
    // index name to be used during the query execution
    index: string;
    nLimit: number | null;
    needToStopHere: ((item: T) => boolean) | null;
    groupBy: GroupBy<T> | null;
    order: "next" | "prev";
  };
  _isFilteredOut: (item: T) => boolean;
  _streamItems: () => AsyncGenerator<T>;
  _streamGroups: (groupBy: GroupBy<T>) => AsyncGenerator<GroupInt<T>>;
  _stream: () => AsyncGenerator<T | GroupInt<T>>;
  filter: (predicate: (item: T) => boolean) => Query<T>;
  byIndex: (indexName: string) => Query<T>;
  from: (lowerBound: any) => Query<T>;
  to: (upperBound: any) => Query<T>;
  takeUntil: (predicate: (item: T) => boolean) => Query<T>;
  take: (n: number) => Query<T>;
  groupBy: (f: ((item: T) => any) | keyof T) => GroupedQuery<T>;
  one: () => Promise<T | null>;
  asc: () => Query<T>;
  desc: () => Query<T>;
  all: () => Promise<T[]>;
  count: () => Promise<number>;
  delete: () => Promise<T[] | GroupInt<T>[]>;
}

type Modify<T, R> = Omit<T, keyof R> & R;

type GroupedQuery<T> = Modify<
  Query<T>,
  {
    take: (n: number) => GroupedQuery<T>;
    filter: (predicate: GroupFilter<T>) => GroupedQuery<T>;
    asc: () => GroupedQuery<T>;
    desc: () => GroupedQuery<T>;
    all: () => Promise<GroupedItems<T>>;
    one: () => Promise<GroupInt<T> | null>;
  }
>;

type QueryBuilder<T> = () => Query<T>;

export interface DbEntity<T, KP extends keyof T> {
  create: (o: Omit<T, KP>, key?: KP) => Promise<T | null>;
  replace: (key: T[KP], payload: Omit<T, KP>) => Promise<T>;
  update: (key: T[KP], payload: Partial<T>) => Promise<T>;
  query: QueryBuilder<T>;
}
type Bound = any;

interface Options<T> {
  keyPath: keyof T;
}

export const createIDBEntity = <T, KP extends keyof T>(
  db: Promise<DbHandle>,
  storeName: string,
  keyPath: KP
): DbEntity<T, KP> => {
  type Predicate = (item: T) => boolean;
  return {
    async create(s, key: KP = undefined) {
      const ddb = await db;
      const tx = ddb.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      if (store === undefined) {
        return null;
      }
      store.put(s, key);
      return s as T;
    },

    async replace(key: T[KP], payload: Omit<T, KP>) {
      const ddb = await db;
      const tx = ddb.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      if (store === undefined) {
        return null;
      }
      const newObj: T = { [keyPath as KP]: key, ...payload } as any;
      await store.put(newObj);
      return newObj;
    },

    async update(key, payload) {
      const ddb = await db;
      const tx = ddb.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      if (store === undefined) {
        return null;
      }
      const existing = await store.get(key as any);
      const newObj = { [keyPath]: key, ...existing, ...payload };
      await store.put(newObj);
      return newObj;
    },

    query() {
      let self: Query<T> = {
        _state: {
          tx: null,
          store: null,
          index: null,
          lowerBound: null,
          upperBound: null,
          filters: [],
          groupFilters: [],
          nLimit: null,
          groupBy: null,
          needToStopHere: null,
          order: "next",
        },

        _isFilteredOut(item: T) {
          for (const p of self._state.filters) {
            if (!p(item)) return true;
          }
          return false;
        },

        async *_streamItems() {
          const ddb = await db;
          const tx = ddb.transaction(storeName, "readonly") as any;
          const store = tx.objectStore(storeName) as any;
          let iterable: any;
          if (self._state.index !== null) {
            const order = self._state.order;
            let range = null;
            const lowerBound =
              self._state.order === "next"
                ? self._state.lowerBound
                : self._state.upperBound;
            const upperBound =
              self._state.order === "next"
                ? self._state.upperBound
                : self._state.lowerBound;
            if (lowerBound && upperBound) {
              range = IDBKeyRange.bound(lowerBound, upperBound);
            } else if (lowerBound) {
              range = IDBKeyRange.lowerBound(lowerBound);
            } else if (upperBound) {
              range = IDBKeyRange.upperBound(upperBound);
            }
            try {
              let c = await store
                .index(self._state.index)
                .openCursor(range, order);
              iterable = {
                [Symbol.asyncIterator]() {
                  return {
                    async next() {
                      if (!c || c.value === undefined) return { done: true };
                      const res = { done: false, value: { value: c.value } };
                      c = await c.continue();
                      return res;
                    },
                  };
                },
              };
            } catch (e) {
              throw {
                error: `Index "${self._state.index}" does not exist on the store "${storeName}"`,
              };
            }
          } else {
            iterable = store;
          }
          for await (const cursor of iterable) {
            const item = cursor.value;
            if (self._isFilteredOut(item)) {
              continue;
            }
            const needToStop =
              self._state.needToStopHere !== null
                ? self._state.needToStopHere(item)
                : false;
            if (needToStop) break;
            yield item;
          }
        },

        async *_streamGroups(
          groupBy: GroupBy<T>
        ): AsyncGenerator<[string, Group<T>]> {
          const grouped: GroupedItems<T> = new Map();
          for await (const item of self._streamItems()) {
            const groupKey = groupBy(item);
            let group = grouped.get(groupKey);
            if (group === undefined) {
              group = [];
              grouped.set(groupKey, group);
            }
            group.push(item);
          }
          for (const k of grouped.keys()) {
            const group = grouped.get(k);
            let filteredOut = false;
            for (const f of self._state.groupFilters) {
              if (!f(k, group)) {
                filteredOut = true;
                break;
              }
            }
            if (filteredOut) {
              continue;
            }
            yield [k, group];
          }
        },

        async *_stream() {
          let yieldedAlready = 0;
          let iterable =
            self._state.groupBy !== null
              ? self._streamGroups(self._state.groupBy)
              : self._streamItems();
          for await (const i of iterable) {
            if (
              self._state.nLimit !== null &&
              yieldedAlready >= self._state.nLimit
            ) {
              break;
            }
            yield i;
            ++yieldedAlready;
          }
        },

        byIndex(idxName: string) {
          self._state.index = idxName;
          return self;
        },

        // Lower bound for index
        from(b: Bound) {
          self._state.lowerBound = b;
          return self;
        },

        // Upper bound for index
        to(b: Bound) {
          self._state.upperBound = b;
          return self;
        },

        asc() {
          self._state.order = "next";
          return self;
        },

        desc() {
          self._state.order = "prev";
          return self;
        },

        // Take n elements from query
        take(n: number) {
          self._state.nLimit = n;
          return self;
        },

        filter(p: Predicate) {
          self._state.filters.push(p);
          return self;
        },

        takeUntil(p: Predicate) {
          self._state.needToStopHere = p;
          return self;
        },

        groupBy(funOrKey): GroupedQuery<T> {
          if (!(funOrKey instanceof Function)) {
            const key: keyof T = funOrKey;
            funOrKey = (s: T) => s[key] as any;
          }
          self._state.groupBy = funOrKey;
          return {
            ...self,
            filter(p: GroupFilter<T>) {
              self._state.groupFilters.push(p);
              return self;
            },
          } as any as GroupedQuery<T>;
        },

        // Return the first item
        async one() {
          for await (const item of self._stream()) {
            return item as any;
          }
          return null;
        },

        async all() {
          if (self._state.groupBy !== null) {
            let res: GroupedItems<T> = new Map();
            for await (const i of self._stream()) {
              const [k, items] = i as GroupInt<T>;
              res.set(k, items);
            }
            return res as any;
          } else {
            let res = [];
            for await (const item of self._stream()) {
              res.push(item as T);
            }
            return res;
          }
        },

        // Count the items returned by query. If groupBy() is used, returns the amount of groups
        async count() {
          let k = 0;
          for await (const _ of self._stream()) {
            ++k;
          }
          return k;
        },

        // Delete all items matching the query
        async delete() {
          const ddb = await db;
          if (self._state.groupBy !== null) {
            let itemsToDelete: GroupInt<T>[] = [];
            for await (const [k, items] of self._streamGroups(
              self._state.groupBy
            )) {
              itemsToDelete.push([k, items]);
            }
            const tx = ddb.transaction(storeName, "readwrite") as any;
            const store = tx.objectStore(storeName) as any;
            for (const [k, items] of itemsToDelete) {
              for (let item of items) {
                store.delete(item[keyPath]);
              }
            }
            return itemsToDelete;
          } else {
            let itemsToDelete: T[] = [];
            for await (const item of self._streamItems()) {
              itemsToDelete.push(item);
            }
            const tx = ddb.transaction(storeName, "readwrite") as any;
            const store = tx.objectStore(storeName) as any;
            for (const item of itemsToDelete) {
              store.delete(item[keyPath]);
            }
            return itemsToDelete;
          }
        },
      };
      return self;
    },
  };
};

export default { createIDBEntity };
