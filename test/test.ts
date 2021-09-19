require("fake-indexeddb/auto");

import * as ORM from "../src/orm";
import { openDB } from "idb/with-async-ittr-cjs.js";

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
  for (const s of sortedStudents) {
    tx.store.put(s);
  }
});

describe("entity creation", () => {
  it("should not crash when creating an entity that exists", () => {
    ORM.createIDBEntity<IStudent, "id">(db, STORE_NAME, "id");
  });
});

describe("entities", () => {
  let Student: ORM.DbEntity<IStudent, "id">;
  beforeAll(() => {
    Student = ORM.createIDBEntity<IStudent, "id">(db, STORE_NAME, "id");
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
      expect(res).toStrictEqual(
        allStudents.sort((a, b) => (a.age > b.age ? 1 : a.age < b.age ? -1 : 0))
      );
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
        allStudents
          .filter((a) => a.age >= 20)
          .sort((a, b) => (a.age > b.age ? 1 : a.age < b.age ? -1 : 0))
      );
    });

    it("should handle from() combined with to() bounds properly with all()", async () => {
      const res = await Student.query().byIndex("age").from(19).to(20).all();
      expect(res).toStrictEqual(
        allStudents
          .filter((a) => a.age >= 19 && a.age <= 20)
          .sort((a, b) => (a.age > b.age ? 1 : a.age < b.age ? -1 : 0))
      );
    });

    it("take() works correctly on non-grouped queries", async () => {
      const n = 2;
      const res = await Student.query().take(n).all();
      const expected = arrayTake(allStudents, n);
      expect(res).toEqual(expected);
    });

    it("should correctly group based on a key", async () => {
      const res = await Student.query().groupBy("age").all();
      expect(res).toEqual(studentsGroupedByAge);
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

    it("should return the length of items on count() with groupBy()", async () => {
      const res = await Student.query().groupBy("age").count();
      expect(res).toEqual(Array.from(studentsGroupedByAge.keys()).length);
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
  });
});
