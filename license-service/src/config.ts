export const config = {
  port: Number(process.env.LICENSE_PORT ?? 4001),
  dbPath: process.env.LICENSE_DB_PATH ?? "./data/license.db",
};
