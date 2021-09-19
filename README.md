# Simple TypeScript IDB wrapper

## Examples:

### Create an Article entity

```typescript
import { createIDBEntity } from "idb-orm";
// create your own database
const db = createDb();

interface IArticle {
  author: string;
  string: string;
  text: string;
  tags: string[];
}
const Student = createIDBEntity<IStudent>(
  "students", // store name
  "id" // keyPath
);
```

### New entity

```typescript
Student.create({
    author: "John Smith";
    title: "Ut aliquet facilisis turpis",
    text: ` Amet bibendum euismod, leo diam interdum ligula, eu scelerisque sem
              purus in tellus.

    Lorem ipsum dolor sit amet, consectetuer adipiscing elit. In sit amet nunc id
    quam porta varius. Ut aliquet facilisis turpis. Etiam pellentesque quam et
    erat. Praesent suscipit justo.
    `;
    created: new Date(),
    tags: ["stuff", "life", "cats"],
})
```

### Queries

```typescript
// Get all articles that
Student.query()
  .byIndex("created")
  // had been posted in the range from 1st september of 2013
  .from(new Date("2013-09-01"))
  // to 1st september of 2014
  .to(new Date("2014-09-01"))
  // that were about cars
  .filter((art) => art.tags.find("cars"))
  // then group by month
  .groupBy(
    (art) =>
      new Date(
        art.created.getFullYear(), //
        art.created.getMonth()
      )
  )
  // take only the first 10 months
  .take(10)
  .all();
```
