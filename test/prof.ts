import * as ORM from "../src/orm";
// import * as idb from "idb/with-async-ittr-cjs.js";

const DB_NAME = "test-db";
const ASYNC_DB_NAME = "async-test-db";
const STORE_NAME = "test-store";
const VERSION = 5;

interface IStudent {
  id: number;
  name: string;
  age: number;
  major: string;
}

const openVanilla = (): Promise<any> => {
  return new Promise((resolve, reject) => {
    let DBOpenRequest = window.indexedDB.open(DB_NAME, VERSION);
    DBOpenRequest.onerror = function (event) {
      reject(event);
    };
    let db;
    DBOpenRequest.onsuccess = function (event) {
      console.info("Initialized database");
      db = DBOpenRequest.result;
      resolve(db);
    };
    DBOpenRequest.onupgradeneeded = function (event: any) {
      let db = event.target.result;
      db.onerror = function (event: any) {
        reject(event);
      };
      const objectStore = db.createObjectStore(STORE_NAME, {
        keyPath: "id",
        autoIncrement: true,
      });
      objectStore.createIndex("age", "age", { unique: false });
      objectStore.createIndex("name", "name", { unique: false });
    };
  });
};

// const openIDB = (): Promise<ORM.DbHandle> => {
//   return idb.openDB(ASYNC_DB_NAME, VERSION, {
//     upgrade(
//       upgradeDb: any,
//       oldVersion: any,
//       newVersion: any,
//       transaction: any
//     ) {
//       console.log("upgrading database with async-iterators");
//       if (!upgradeDb.objectStoreNames.contains(STORE_NAME)) {
//         const tiDb = upgradeDb.createObjectStore(STORE_NAME, {
//           keyPath: "id",
//           autoIncrement: true,
//         });
//         tiDb.createIndex("name", "name", { unique: false });
//         tiDb.createIndex("age", "age", { unique: false });
//       }
//     },
//   });
// };
//
const totalEntries = 20000;

const toDuration = (dur: Date | null) =>
  dur !== null ? dur.toISOString().substr(11, 8) : "N/A";
const generateItems = function* () {
  for (let i = 0; i < totalEntries; ++i) {
    const s = {
      id: i,
      name: "Random",
      age: Math.round(Math.random() * 100),
      major: "Random Science",
    };
    yield s;
  }
};
const memoryUsedMB = () =>
  (window.performance as any).memory.usedJSHeapSize / 1024 / 1024;

const profWithORM = async () => {
  console.info("[ORM] PERF TEST");
  const db = await openVanilla();
  db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).clear();
  (window as any).db = db;
  const Student = ORM.createIDBEntity<IStudent, "id">(db, STORE_NAME, "id");
  console.info("[ORM] Inserting...");
  const items = Array.from(generateItems());
  await Student.createMany(items);
  console.info("[ORM] Done.");
  console.info(`[ORM] Querying about ${totalEntries / 100} items`);
  const started = Date.now();
  const studentGot = await Student.query()
    .byIndex("age")
    .from(80)
    .to(81)
    .groupBy("age")
    .all();
  const ended = Date.now();
  const took = toDuration(new Date(new Date(ended - started)));
  console.log(
    `[ORM] Queried a total of ${studentGot} items. Query took ${took} seconds. Memory usage: ${memoryUsedMB()}MB`
  );
};

const profVanilla = async (): Promise<void> => {
  console.info("[VANILLA] PERF TEST");
  const db = await openVanilla();
  (window as any).db = db;
  console.info("[VANILLA] Inserting...");
  db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).clear();
  const st = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME);
  for (const s of generateItems()) {
    st.put(s);
  }
  console.info("[VANILLA] Done.");
  console.info(`[VANILLA] Querying about ${totalEntries / 100} items`);
  const started = Date.now();
  async function* gen(): AsyncGenerator<IStudent> {
    const cursor = db
      .transaction(STORE_NAME, "readonly")
      .objectStore(STORE_NAME)
      .index("age")
      .openCursor(IDBKeyRange.bound(80, 81));
    const items: IStudent[] = await new Promise((resolve, reject) => {
      let studentGot: IStudent[] = [];
      cursor.onsuccess = (event: any) => {
        var c = event.target.result;
        if (c) {
          studentGot.push(c.value);
          c.continue();
        } else {
          const ended = Date.now();
          const took = toDuration(new Date(new Date(ended - started)));
          console.log(
            `[VANILLA] Queried a total of ${
              studentGot.length
            } items. Query took ${took} seconds. Memory usage: ${memoryUsedMB()}MB`
          );
          resolve(studentGot);
        }
      };
    });
    for (const student of items) yield student;
  }
  for await (const item of gen()) {
  }
};

const main = async () => {
  console.info("[ORM] Total entries", totalEntries);
  // await profVanilla();
  await profWithORM();
};

main();
