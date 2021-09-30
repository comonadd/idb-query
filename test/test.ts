require("fake-indexeddb/auto");

import * as ORM from "../src/orm";
import { openDB, unwrap } from "idb/with-async-ittr-cjs.js";

const arrayTake = (arr: any[], n: number) => {
  let res: typeof arr = [];
  for (let i = 0; i < n; ++i) res.push(arr[i]);
  return res;
};

const DB_NAME = "test-db";
const STORE_NAME = "test-store";

interface IStudent {
  id: number;
  name: string;
  age: number;
  major: string;
}

const idComparator = (a: IStudent, b: IStudent) =>
  a.id > b.id ? 1 : a.id < b.id ? -1 : 0;

let __id = 1;
const withId = (i: Omit<IStudent, "id">) => {
  if ((i as any).id !== undefined) return i as IStudent;
  const s = { id: __id, ...i };
  __id++;
  return s;
};

const withIds = (is: Omit<IStudent, "id">[]) => is.map(withId);

const donald: IStudent = withId({
  name: "Donald",
  age: 18,
  major: "Business",
});

const teenageStudents: IStudent[] = withIds([
  { name: "William", age: 19, major: "Arts" },
  ...[donald],
]).sort(idComparator);

const twentyYearOlds: IStudent[] = withIds([
  { name: "John", age: 20, major: "Computer Science" },
  { name: "Franklin", age: 20, major: "History" },
]);

const allStudents: IStudent[] = withIds([
  ...teenageStudents,
  ...twentyYearOlds,
  { name: "Adam", age: 22, major: "Math" },
]);

const studentsGroupedByAge = allStudents.reduce((acc, s) => {
  if (acc.get(s.age) === undefined) {
    acc.set(s.age, []);
  }
  acc.get(s.age).push(s);
  return acc;
}, new Map() as ORM.GroupedItems<IStudent>);

const openIDB = (): Promise<ORM.DbHandle> => {
  return openDB(DB_NAME, 1, {
    upgrade(
      upgradeDb: any,
      oldVersion: any,
      newVersion: any,
      transaction: any
    ) {
      if (!upgradeDb.objectStoreNames.contains(STORE_NAME)) {
        const tiDb = upgradeDb.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true,
        });
        tiDb.createIndex("name", "name", { unique: false });
        tiDb.createIndex("age", "age", { unique: false });
      }
    },
  });
};

// const openIDB = (): Promise<any> => {
//   return new Promise((resolve, reject) => {
//     let DBOpenRequest = indexedDB.open(DB_NAME, 1);
//     DBOpenRequest.onerror = function (event) {
//       reject(event);
//     };
//     let db;
//     DBOpenRequest.onsuccess = function (event) {
//       db = DBOpenRequest.result;
//       resolve(db);
//     };
//     DBOpenRequest.onupgradeneeded = function (event: any) {
//       let db = event.target.result;
//       db.onerror = function (event: any) {
//         reject(event);
//       };
//       const objectStore = db.createObjectStore(STORE_NAME, {
//         keyPath: "id",
//         autoIncrement: true,
//       });
//       objectStore.createIndex("age", "age", { unique: false });
//       objectStore.createIndex("name", "name", { unique: false });
//     };
//   });
// };
//
type AsyncReturnType<T extends (...args: any) => any> = T extends (
  ...args: any
) => Promise<infer U>
  ? U
  : T extends (...args: any) => infer U
  ? U
  : any;

const db = openIDB();

beforeAll(async () => {
  const ddb = await db;
  const tx = ddb.transaction(STORE_NAME, "readwrite");
  const sortedStudents = allStudents.sort(idComparator);
  const store = tx.objectStore(STORE_NAME);
  for (const s of sortedStudents) {
    store.put(s);
  }
});

describe("entity creation", () => {
  it("should not crash when creating an entity that exists", () => {
    ORM.createIDBEntity<IStudent, "id">(db, STORE_NAME, "id", unwrap);
  });
});

const studentsCompAsc = (a: IStudent, b: IStudent) =>
  a.age > b.age
    ? 1
    : a.age < b.age
    ? -1
    : a.id > b.id
    ? 1
    : a.id < b.id
    ? -1
    : 0;

const studentsCompDesc = (a: IStudent, b: IStudent) => {
  const res = studentsCompAsc(a, b);
  if (res === -1) return 1;
  if (res === 1) return -1;
  return 0;
};

describe("entities", () => {
  let Student: ORM.DbEntity<IStudent, "id">;
  beforeAll(() => {
    Student = ORM.createIDBEntity<IStudent, "id">(db, STORE_NAME, "id", unwrap);
  });

  describe("query", () => {
    it("should return all entities on all()", async () => {
      const res = await Student.query().all();
      expect(res).toEqual(allStudents);
    });

    it("should filter certain entities on when called with all()", async () => {
      const res = await Student.query()
        .filter((s) => s.age < 20)
        .all();
      expect(res).toEqual(teenageStudents);
    });

    it("should sort if byIndex() is applied with all()", async () => {
      const res = await Student.query().byIndex("age").all();
      const expected = allStudents.sort((a, b) =>
        a.age > b.age ? 1 : a.age < b.age ? -1 : 0
      );
      expect(res).toStrictEqual(expected);
    });

    it("should sort in descending order properly if desc() is applied with all()", async () => {
      const res = await Student.query().byIndex("age").desc().all();
      const expected = allStudents.sort(studentsCompDesc);
      expect(res).toStrictEqual(expected);
    });

    it("should fail if specified index in byIndex() does not exist", async () => {
      const idxName = "index-that-does-not-exist";
      expect(async () => {
        await Student.query().byIndex(idxName).all();
      }).rejects.toEqual({
        error: `Index "${idxName}" does not exist on the store "${STORE_NAME}"`,
      });
    });

    it("should handle from() lower bound properly with all()", async () => {
      const res = await Student.query().byIndex("age").from(20).all();
      expect(res).toStrictEqual(
        allStudents.filter((a) => a.age >= 20).sort(studentsCompAsc)
      );
    });

    it("should handle from() combined with to() bounds properly with all()", async () => {
      const res = await Student.query().byIndex("age").from(19).to(20).all();
      const expected = allStudents
        .filter((a) => a.age >= 19 && a.age <= 20)
        .sort(studentsCompAsc);
      expect(res).toStrictEqual(expected);
    });

    it("take() works correctly on non-grouped queries", async () => {
      const n = 2;
      const res = await Student.query().asc().take(n).all();
      const expected = arrayTake(allStudents.sort(studentsCompAsc), n);
      expect(res).toEqual(expected);
    });

    it("should correctly group based on a key", async () => {
      const res = await Student.query().groupBy("age").all();
      expect(res).toEqual(studentsGroupedByAge);
    });

    it("should correctly group based on a key and sort in descending order", async () => {
      const res = await Student.query()
        .byIndex("age")
        .from(20)
        .desc()
        .groupBy((item) => {
          return item.age;
        })
        .all();
      const expected = new Map(
        Array.from(studentsGroupedByAge.entries())
          .map(([k, e]) => [k, e.reverse()] as any)
          .filter(([k, _]) => k <= 20)
          .reverse()
      );
      expect(res).toEqual(expected);
    });

    it("should correctly group and filter based on a key", async () => {
      const res = await Student.query()
        .groupBy("age")
        .filter((age, students) => age === 18)
        .all();
      const expectedEntries = Array.from(studentsGroupedByAge.entries()).filter(
        ([k, _]) => (k as any) === 18
      );
      const expected = new Map(expectedEntries);
      expect(res).toEqual(expected);
    });

    it("group + take works correctly", async () => {
      const n = 2;
      const res = await Student.query().groupBy("age").take(n).all();
      const expectedEntries = arrayTake(
        Array.from(studentsGroupedByAge.entries()),
        n
      );
      const expected = new Map(expectedEntries);
      expect(res).toEqual(expected);
    });

    it("should return the length of items on count()", async () => {
      const res = await Student.query()
        .filter((s) => s.age < 20)
        .count();
      expect(res).toEqual(teenageStudents.length);
    });

    it("count() should return full length when it's the only specified qualifier", async () => {
      const res = await Student.query().count();
      expect(res).toEqual(allStudents.length);
    });

    it("should count() items properly when index is applied ", async () => {
      const res = await Student.query().byIndex("age").count();
      expect(res).toEqual(allStudents.length);
    });

    it("should return the length of items on count() with groupBy()", async () => {
      const res = await Student.query().groupBy("age").count();
      expect(res).toEqual(Array.from(studentsGroupedByAge.keys()).length);
    });

    it("offset()", async () => {
      const res = await Student.query().offset(2).all();
      expect(res).toEqual(allStudents.slice(2));
    });

    it("should delete single items matched by query correctly", async () => {
      const res = await Student.query()
        .filter((s) => s.age === 18)
        .delete();
      expect(res).toEqual([donald]);
      expect(
        await Student.query()
          .filter((s) => s.age === 18)
          .one()
      ).toEqual(null);
    });

    it("should delete groups matched by query correctly", async () => {
      const res = await Student.query()
        .groupBy("age")
        .filter((k, items) => k === 20)
        .delete();
      expect(res).toEqual([[20, twentyYearOlds]]);
      expect(
        await Student.query()
          .filter((s) => s.age === 20)
          .one()
      ).toEqual(null);
    });
  });

  describe("Entity.create", () => {
    it("should correctly create entities", async () => {
      const s = withId({
        name: "Steve",
        age: 999,
        major: "Administration",
      });
      const res: IStudent = await Student.create(s);
      expect(res).toEqual(s);
      expect(
        await Student.query()
          .filter((s) => s.age === 999)
          .one()
      ).toStrictEqual(s);
    });

    it("should not fail creating multiple entities in a row", async () => {
      const students = [
        withId({
          name: "Steve",
          age: 283,
          major: "Administration",
        }),
        withId({ name: "Joshua", age: 12, major: "Cooking" }),
        withId({
          name: "Rebecca",
          age: 32,
          major: "Psychology",
        }),
      ];
      for (const s of students) {
        const res: IStudent = await Student.create(s);
        expect(res).toEqual(s);
        expect(
          await Student.query()
            .filter((st) => st.age === s.age)
            .one()
        ).toStrictEqual(s);
      }
    });
  });

  describe("Entity.replace", () => {
    it("should replace existing entities", async () => {
      const s = withId({
        name: "Martin",
        age: 823,
        major: "Computer Science",
      });
      const res: IStudent = await Student.create(s);
      expect(res).toEqual(s);
      const studentGot = await Student.query()
        .filter((sk) => sk.id === s.id)
        .one();
      expect(studentGot).toStrictEqual(s);
      const newStudent = {
        age: 111,
        name: "Jonathan",
        major: "Administration",
      };
      Student.replace(studentGot.id, newStudent);
      const studentAfterUpdate = await Student.query()
        .filter(({ id }) => id === s.id)
        .all();
      expect(studentAfterUpdate.length).toEqual(1);
      expect(studentAfterUpdate[0]).toStrictEqual({
        id: s.id,
        ...newStudent,
      });
    });
  });

  describe("Entity.update", () => {
    it("should update existing entities", async () => {
      const s = withId({
        name: "Martin",
        age: 823,
        major: "Computer Science",
      });
      const res: IStudent = await Student.create(s);
      expect(res).toEqual(s);
      const studentGot = await Student.query()
        .filter((sk) => sk.id === s.id)
        .one();
      expect(studentGot).toStrictEqual(s);
      Student.update(studentGot.id, { major: "Administration" });
      const studentAfterUpdate = await Student.query()
        .filter(({ id }) => id === s.id)
        .all();
      expect(studentAfterUpdate.length).toEqual(1);
      expect(studentAfterUpdate[0]).toStrictEqual({
        ...s,
        major: "Administration",
      });
    });
  });

  describe("Entity.delete", () => {
    it("should delete single items", async () => {
      const s = withId({
        name: "Martin",
        age: 823,
        major: "Computer Science",
      });
      const res: IStudent = await Student.create(s);
      await Student.delete(s.id);
      const studentAfterUpdate = await Student.query()
        .filter(({ id }) => id === s.id)
        .all();
      expect(studentAfterUpdate.length).toEqual(0);
    });

    it("should delete many items at once", async () => {
      const s = withId({
        name: "Martin",
        age: 823,
        major: "Computer Science",
      });
      await Student.create(s);
      const s1 = withId({
        name: "Martin",
        age: 323,
        major: "Computer Science",
      });
      await Student.create(s1);
      await Student.deleteMany([s.id, s1.id]);
      const studentAfterUpdate = await Student.query()
        .filter(({ id }) => id === s.id || id === s1.id)
        .all();
      expect(studentAfterUpdate.length).toEqual(0);
    });
  });
});
