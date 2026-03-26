import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { normalizeBookRecord } from "@/lib/books/book-record";
import type { BookRecord } from "@/lib/books/types";

type ReBabelDB = DBSchema & {
  books: {
    key: string;
    value: BookRecord;
    indexes: {
      "by-updated-at": string;
    };
  };
};

const DATABASE_NAME = "rebabel-db";
const DATABASE_VERSION = 1;

let databasePromise: Promise<IDBPDatabase<ReBabelDB>> | null = null;

function getDatabase() {
  if (!databasePromise) {
    databasePromise = openDB<ReBabelDB>(DATABASE_NAME, DATABASE_VERSION, {
      upgrade(database) {
        const booksStore = database.createObjectStore("books", {
          keyPath: "id",
        });

        booksStore.createIndex("by-updated-at", "updatedAt");
      },
    });
  }

  return databasePromise;
}

export async function listBooks() {
  const database = await getDatabase();
  const books = await database.getAll("books");

  return books
    .map((book) =>
      normalizeBookRecord(book, {
        resetTranslating: true,
      }),
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function saveBook(book: BookRecord) {
  const database = await getDatabase();
  await database.put("books", normalizeBookRecord(book));
}

export async function deleteBook(bookId: string) {
  const database = await getDatabase();
  await database.delete("books", bookId);
}
