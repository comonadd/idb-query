// import {
//   IDBPDatabase,
//   IDBPIndex,
//   IDBPObjectStore,
//   IDBPCursorWithValueIteratorValue,
// } from "idb";

export type DbHandle = any;

type GroupKey<T> = any;
type GroupBy<T> = (item: T) => GroupKey<T>;
type Group<T> = T[];
export type GroupedItems<T> = Map<GroupKey<T>, Group<T>>;
type GroupInt<T> = [GroupKey<T>, Group<T>];
type GroupFilter<T> = (groupKey: GroupKey<T>, groupItems: Group<T>) => boolean;
type Query<T> = {
  _state: {
    tx: IDBTransaction | null;
    store: any | null;
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
  _determineRange: () => IDBKeyRange;
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
};

type Modify<T, R> = Omit<T, keyof R> & R;

type FunctionPropertyNames<T> = {
  [K in keyof T]: T[K] extends Function ? K : never;
}[keyof T];
type FunctionProperties<T> = Pick<T, FunctionPropertyNames<T>>;
export type GroupedQuery<T> = Modify<
  Omit<Query<T>, "take" | "desc"> &
    {
      [Property in keyof FunctionProperties<Query<T>> as Exclude<
        Property,
        | "_isFilteredOut"
        | "_streamItems"
        | "_streamGroups"
        | "_stream"
        | "_determineRange"
        | "all"
        | "count"
        | "delete"
      >]: (
        ...args: Parameters<FunctionProperties<Query<T>>[Property]>
      ) => GroupedQuery<T>;
    },
  {
    filter: (predicate: GroupFilter<T>) => GroupedQuery<T>;
    all: () => Promise<GroupedItems<T>>;
    one: () => Promise<GroupInt<T> | null>;
  }
>;

export type QueryBuilder<T> = () => Query<T>;

export type Store = any;

export interface Transaction {
  store: Store;
}

export interface DbEntity<T, KP extends keyof T> {
  create: (o: Omit<T, KP>, key?: KP) => Promise<T | null>;
  createMany: (items: T[]) => Promise<boolean>;
  replace: (
    key: T[KP],
    payload: Omit<T, KP>,
    transaction?: Transaction
  ) => Promise<T>;
  update: (
    key: T[KP],
    payload: Partial<T>,
    transaction?: Transaction
  ) => Promise<T>;
  query: QueryBuilder<T>;
  createTransaction: (mode: Mode) => Promise<Transaction>;
}
type Bound = any;

interface Options<T> {
  keyPath: keyof T;
}

export type Unwrap = (db: any) => any;

export type Mode = "readwrite" | "readonly";

/**
 * Creates an entity that can be later queried.
 *
 * @param ddb - Promise that returns the database handler
 * @param storeName - The name of the store that this entity operates on
 * @param keyPath - Key for entity (the one you specified during database upgrade)
 * @param unwrap - Required if you are using the "idb" library
 *                 (https://github.com/jakearchibald/idb). Transformes the enhanced
 *                 object into a default one. Import unwrap from "idb" package and
 *                 then pass here.
 * @returns wrapped entity
 */
export const createIDBEntity = <T, KP extends keyof T>(
  ddb: Promise<DbHandle>,
  storeName: string,
  keyPath: KP,
  unwrap: Unwrap | null = null
): DbEntity<T, KP> => {
  type Predicate = (item: T) => boolean;

  const getStore = async (mode: Mode) => {
    let db = await ddb;
    if (db.hasOwnProperty("_rawDatabase")) {
      // If this is an async-idb object, unwrap it first
      db = unwrap(db);
    }
    return db.transaction(storeName, mode).objectStore(storeName);
  };

  return {
    async create(s, key: KP = undefined) {
      const store = await getStore("readwrite");
      store.put(s, key);
      return s as T;
    },

    async createMany(items: T[]) {
      const store = await getStore("readwrite");
      for (const item of items) {
        store.put(item);
      }
      return true;
    },

    async createTransaction(mode: Mode) {
      const store = await getStore(mode);
      return { store };
    },

    async replace(key: T[KP], payload: Omit<T, KP>, transaction?: Transaction) {
      const newObj: T = { [keyPath as KP]: key, ...payload } as any;
      const store = transaction
        ? transaction.store
        : await getStore("readwrite");
      await new Promise<void>((resolve, reject) => {
        const req = store.put(newObj);
        req.onsuccess = () => resolve();
      });
      return newObj;
    },

    async update(key, payload, transaction?: Transaction) {
      const store = transaction
        ? transaction.store
        : await getStore("readwrite");
      return new Promise((resolve) => {
        const c = store.get(key as any);
        c.onsuccess = (event: any) => {
          const existing = event.target.result;
          const newObj = { [keyPath]: key, ...existing, ...payload };
          const putc = store.put(newObj);
          putc.onsuccess = (event: any) => {
            resolve(newObj);
          };
        };
      });
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

        _determineRange() {
          let lowerBound = null;
          let upperBound = null;
          if (self._state.order === "next") {
            lowerBound = self._state.lowerBound;
            upperBound = self._state.upperBound;
          } else {
            lowerBound = self._state.upperBound;
            upperBound = self._state.lowerBound;
          }
          if (lowerBound && upperBound) {
            return IDBKeyRange.bound(lowerBound, upperBound);
          } else if (lowerBound) {
            return IDBKeyRange.lowerBound(lowerBound);
          } else if (upperBound) {
            return IDBKeyRange.upperBound(upperBound);
          }
        },

        async *_streamItems() {
          let iterable: T[] = [];
          const store = await getStore("readonly");
          if (self._state.index !== null) {
            const order = self._state.order;
            let range: IDBKeyRange = self._determineRange();
            try {
              const cursor = store
                .index(self._state.index)
                .openCursor(range, order);
              iterable = await new Promise((resolve, reject) => {
                let items: typeof iterable = [];
                cursor.onsuccess = (event: any) => {
                  const c = event.target.result;
                  if (c) {
                    items.push(c.value);
                    c.continue();
                  } else {
                    resolve(items);
                  }
                };
              });
            } catch (e) {
              throw {
                error: `Index "${self._state.index}" does not exist on the store "${storeName}"`,
              };
            }
          } else {
            const cursor = store.getAll();
            iterable = await new Promise((resolve, reject) => {
              cursor.onsuccess = (event: any) => {
                const items = event.target.result;
                resolve(items);
              };
            });
          }
          for (const item of iterable) {
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
          if (self._state.groupBy !== null) {
            let itemsToDelete: GroupInt<T>[] = [];
            for await (const [k, items] of self._streamGroups(
              self._state.groupBy
            )) {
              itemsToDelete.push([k, items]);
            }
            const store = await getStore("readwrite");
            for (const [k, items] of itemsToDelete) {
              for (let item of items) {
                store.delete(item[keyPath] as any);
              }
            }
            return itemsToDelete;
          } else {
            let itemsToDelete: T[] = [];
            for await (const item of self._streamItems()) {
              itemsToDelete.push(item);
            }
            const store = await getStore("readwrite");
            for (const item of itemsToDelete) {
              store.delete(item[keyPath] as any);
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
