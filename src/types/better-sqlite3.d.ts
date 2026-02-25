declare module 'better-sqlite3' {
  interface Database {
    prepare(sql: string): Statement;
    exec(sql: string): this;
    pragma(pragma: string, options?: any): any;
    close(): this;
    transaction<T>(fn: (...args: any[]) => T): (...args: any[]) => T;
  }

  interface Statement {
    run(...params: any[]): RunResult;
    get(...params: any[]): any;
    all(...params: any[]): any[];
    iterate(...params: any[]): IterableIterator<any>;
    pluck(toggle?: boolean): this;
    expand(toggle?: boolean): this;
    raw(toggle?: boolean): this;
    columns(): ColumnDefinition[];
    bind(...params: any[]): this;
  }

  interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  interface ColumnDefinition {
    name: string;
    column: string | null;
    table: string | null;
    database: string | null;
    type: string | null;
  }

  interface Options {
    readonly?: boolean;
    fileMustExist?: boolean;
    timeout?: number;
    verbose?: (message?: any, ...additionalArgs: any[]) => void;
    nativeBinding?: string;
  }

  interface DatabaseConstructor {
    new (filename: string, options?: Options): Database;
    (filename: string, options?: Options): Database;
    prototype: Database;
    SqliteError: typeof SqliteError;
  }

  class SqliteError extends Error {
    code: string;
    constructor(message: string, code: string);
  }

  const Database: DatabaseConstructor;
  export = Database;
}
