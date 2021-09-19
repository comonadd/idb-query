import * as idb from "idb/with-async-ittr.js";
import {
  IDBPDatabase,
  IDBPIndex,
  IDBPObjectStore,
  IDBPCursorWithValueIteratorValue,
} from "idb";

export type DbHandle = IDBPDatabase<unknown>;

type GroupKey = any;
type GroupBy<T> = (item: T) => GroupKey;
type Group<T> = T[];
export type GroupedItems<T> = Record<GroupKey, Group<T>>;
interface Query<T> {
  _state: {
    tx: IDBTransaction | null;
    store: IDBPObjectStore | null;
    range: IDBKeyRange | null;
    filters: ((item: T) => boolean)[];
    lowerBound: any | null;
    index: IDBPIndex;
    nLimit: number | null;
    needToStopHere: ((item: T) => boolean) | null;
    groupBy: GroupBy<T> | null;
  };
  _isFilteredOut: (item: T) => boolean;
  _streamItems: () => AsyncGenerator<T>;
  _streamGroups: (groupBy: GroupBy<T>) => AsyncGenerator<[GroupKey, Group<T>]>;
  _stream: () => AsyncGenerator<T | Group<T>>;
  filter: (predicate: (item: T) => boolean) => Query<T>;
  byIndex: (indexName: string) => Query<T>;
  from: (lowerBound: any) => Query<T>;
  to: (upperBound: any) => Query<T>;
  takeUntil: (predicate: (item: T) => boolean) => Query<T>;
  take: (n: number) => Query<T>;
  groupBy: (f: GroupBy<T> | keyof T) => Query<T>;
  one: () => Promise<T | Group<T> | null>;
  all: () => Promise<T[] | GroupedItems<T>>;
  count: () => Promise<number>;
}

type QueryBuilder<T> = () => Query<T>;

export interface DbEntity<T> {
  create: (o: T) => T | null;
  query: QueryBuilder<T>;
}
type Bound = any;

export const createDbEntity = <T>(
  db: DbHandle,
  storeName: string
): DbEntity<T> => {
  type Predicate = (item: T) => boolean;
  return {
    create(s: T): T {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName) as any;
      if (store === undefined) {
        return null;
      }
      store.put(s);
      return s;
    },
    query(): Query<T> {
      let self: Query<T> = {
        _state: {
          tx: null,
          store: null,
          range: null,
          index: null,
          lowerBound: null,
          filters: [],
          nLimit: null,
          groupBy: null,
          needToStopHere: null,
        },

        _isFilteredOut(item: T) {
          for (const p of self._state.filters) {
            if (!p(item)) return true;
          }
          return false;
        },

        async *_streamItems() {
          let iterable: any;
          if (self._state.index !== null) {
            iterable = self._state.index.iterate(self._state.range);
          } else {
            iterable = self._state.store;
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
          const grouped: GroupedItems<T> = {};
          for await (const item of self._streamItems()) {
            const groupKey = groupBy(item);
            let group = grouped[groupKey];
            if (group === undefined) {
              group = [];
              grouped[groupKey] = group;
            }
            group.push(item);
          }
          for (const k of Object.keys(grouped)) {
            const group = grouped[k];
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
          try {
            const index = self._state.store.index(idxName);
            self._state.index = index;
            return self;
          } catch (NotFoundError) {
            throw {
              error: `Index "${idxName}" does not exist on the store "${storeName}"`,
            };
          }
        },

        // Lower bound for index
        from(b: Bound) {
          self._state.lowerBound = b;
          self._state.range = IDBKeyRange.lowerBound(b);
          return self;
        },

        // Upper bound for index
        to(b: Bound) {
          if (self._state.range === null) {
            self._state.range = IDBKeyRange.upperBound(b);
          } else {
            self._state.range = IDBKeyRange.bound(self._state.lowerBound, b);
          }
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

        groupBy(funOrKey) {
          if (!(funOrKey instanceof Function)) {
            const key: keyof T = funOrKey;
            funOrKey = (s: T) => s[key];
          }
          self._state.groupBy = funOrKey;
          return self;
        },

        // Return the first item
        async one() {
          for await (const item of self._stream()) {
            return item;
          }
          return null;
        },

        async all(): Promise<T[] | GroupedItems<T>> {
          if (self._state.groupBy !== null) {
            let res: GroupedItems<T> = {};
            for await (const [k, items] of self._streamGroups(
              self._state.groupBy
            )) {
              res[k] = items;
            }
            return res;
          } else {
            let res = [];
            for await (const item of self._streamItems()) {
              res.push(item);
            }
            return res;
          }
        },

        async count() {
          let k = 0;
          for await (const _ of self._stream()) {
            ++k;
          }
          return k;
        },
      };
      self._state.tx = db.transaction(storeName, "readonly") as any;
      self._state.store = self._state.tx.objectStore(storeName) as any;
      return self;
    },
  };
};

export default { createDbEntity };
