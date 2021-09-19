require("fake-indexeddb/auto");

import * as ORM from "../src/orm";
import { openDB } from "idb/with-async-ittr-cjs.js";

const DB_NAME = "test-db";
const STORE_NAME = "test-store";

interface IStudent {
  name: string;
  age: number;
  major: string;
}

const teenageStudents: IStudent[] = [
  { name: "William", age: 19, major: "Arts" },
  { name: "Donald", age: 18, major: "Business" },
];

const allStudents: IStudent[] = [
  ...teenageStudents,
  { name: "John", age: 20, major: "Computer Science" },
  { name: "Adam", age: 22, major: "Math" },
];

const studentsGroupedByAge = allStudents.reduce((acc, s) => {
  if (acc[s.age] === undefined) {
    acc[s.age] = [];
  }
  acc[s.age].push(s);
  return acc;
}, {} as ORM.GroupedItems<IStudent>);

const openIDB = async (): Promise<ORM.DbHandle> => {
  return await openDB(DB_NAME, 1, {
    upgrade(
      upgradeDb: any,
      oldVersion: any,
      newVersion: any,
      transaction: any
    ) {
      if (!upgradeDb.objectStoreNames.contains(STORE_NAME)) {
        const tiDb = upgradeDb.createObjectStore(STORE_NAME, {
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

let db: AsyncReturnType<typeof openIDB>;

beforeAll(async () => {
  db = await openIDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  for (const s of allStudents) {
    tx.store.put(s);
  }
});

describe("entities", () => {
  describe("creation", () => {
    it("should not crash when creating an entity that exists", () => {
      ORM.createDbEntity(db, STORE_NAME);
    });
  });

  describe("query", () => {
    let Student: ORM.DbEntity<IStudent>;
    beforeAll(() => {
      Student = ORM.createDbEntity<IStudent>(db, STORE_NAME);
    });

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

    it("should correctly group based on a key", async () => {
      const res = await Student.query().groupBy("age").all();
      expect(res).toEqual(studentsGroupedByAge);
    });

    it("should return the length of items on count()", async () => {
      const res = await Student.query()
        .filter((s) => s.age < 20)
        .count();
      expect(res).toEqual(teenageStudents.length);
    });

    it("should return the length of items on count() with groupBy()", async () => {
      const res = await Student.query().groupBy("age").count();
      expect(res).toEqual(Object.keys(studentsGroupedByAge).length);
    });
  });

  describe("Entity.create", () => {
    let Student: ORM.DbEntity<IStudent>;
    beforeAll(() => {
      Student = ORM.createDbEntity<IStudent>(db, STORE_NAME);
    });
    it("should correctly create entities", async () => {
      const s = {
        name: "Steve",
        age: 999,
        major: "Administration",
      };
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
