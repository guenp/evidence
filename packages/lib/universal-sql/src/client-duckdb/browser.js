import { arrowTableToJSON, apacheToEvidenceType, getPromise, withTimeout } from './both.js';
import {
	AsyncDuckDB,
	ConsoleLogger,
	DuckDBDataProtocol,
	getPlatformFeatures,
	VoidLogger
} from '@duckdb/duckdb-wasm';

import { Table } from 'apache-arrow';

export { tableFromIPC } from 'apache-arrow';

import { MDConnection } from '@motherduck/wasm-client';

/** @type {import("@duckdb/duckdb-wasm").AsyncDuckDB} */
let db;

/** @type {import("@duckdb/duckdb-wasm").AsyncDuckDBConnection} */
let connection;

/** @type {import("@motherduck/wasm-client").MDConnection} */
let md_connection;

const { resolve: resolveInit, reject: rejectInit, promise: initPromise } = getPromise();
const { resolve: resolveTables, reject: rejectTables, promise: tablesPromise } = getPromise();
let initializing = false;

/**
 * Initializes the database.
 *
 * @returns {Promise<void>}
 */
export async function initDB() {
	// If the database is already available, don't do anything
	if (db) return;

	// If the database is already initializing, don't try to do it twice
	// Instead, let the call wait for the initPromise
	if (initializing) return withTimeout(initPromise);
	// This call is the first (to execute), don't let anybody else try
	// to initialize the database
	initializing = true;
	try {
		const useEh = await getPlatformFeatures().then((x) => x.wasmExceptions);

		const DUCKDB_CONFIG = useEh
			? {
					mainModule: (await import('@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url')).default,
					mainWorker: (await import('@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?worker'))
						.default
				}
			: {
					mainModule: (await import('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url')).default,
					mainWorker: (await import('@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?worker'))
						.default
				};

		const logger = import.meta.env.VITE_EVIDENCE_DEBUG ? new ConsoleLogger() : new VoidLogger();
		const worker = new DUCKDB_CONFIG.mainWorker();

		// use an intermediate variable to prevent db from being a not-ready database
		const _db = new AsyncDuckDB(logger, worker);
		await _db.instantiate(DUCKDB_CONFIG.mainModule);
		db = _db;

		await db.open({
			query: {
				castBigIntToDouble: true,
				castTimestampToDate: true,
				castDecimalToDouble: true,
				castDurationToTime64: true
			}
		});
		connection = await db.connect();
		
		resolveInit();

		let token = prompt("Please enter a token:", "Token empty");
		md_connection = MDConnection.create({
			mdToken: token
		});
		await md_connection.isInitialized();

	} catch (e) {
		rejectInit(e);
		throw e;
	}
}

/**
 * Updates the duckdb search path to include only the list of included schemas
 * @param {string[]} schemas
 * @returns {Promise<void>}
 */
export async function updateSearchPath(schemas) {
	if (!db) await initDB();

	await connection.query(`PRAGMA search_path='${schemas.join(',')}'`);
}

/**
 * @param {string} targetGlob
 */
export async function emptyDbFs(targetGlob) {
	await db.flushFiles();
	for (const f of await db.globFiles(targetGlob)) {
		await db.dropFile(f.fileName);
	}
}

/**
 * Adds a new view to the database, pointing to the provided parquet URL.
 * @param {Record<string, string[]>} urls
 * @param {boolean} [append]
 * @returns {Promise<void>}
 */
export async function setParquetURLs(urls, append = false) {
	if (!db) await initDB();
	if (!append) await emptyDbFs('*');
	if (import.meta.env.VITE_EVIDENCE_DEBUG) console.debug('Updating Parquet URLs');

	try {
		for (const source in urls) {
			await connection.query(`CREATE SCHEMA IF NOT EXISTS "${source}";`);
			for (const url of urls[source]) {
				const table = url.split(/[\\/]/).at(-1).slice(0, -'.parquet'.length);
				const file_name = `${source}_${table}.parquet`;
				let path = url;

				if (!url.startsWith('http') && !url.startsWith('/')) {
					// URL Needs to be absolute
					path = `/${url}`;
				}
				// Sveltekit doesn't like referencing the static dir expilcitly
				if (path.startsWith('/static')) path = path.substring(7);

				if (append) {
					await emptyDbFs(file_name);
					await emptyDbFs(url);
				}
				await db.registerFileURL(file_name, path, DuckDBDataProtocol.HTTP, false);
				await connection.query(
					`CREATE OR REPLACE VIEW "${source}"."${table}" AS (SELECT * FROM read_parquet('${file_name}'));`
				);
			}
		}
		resolveTables();
	} catch (e) {
		rejectTables(e);
		throw e;
	}
}

/**
 * Queries the database with the given SQL statement.
 *
 * @param {string} sql
 * @returns {Promise<import("apache-arrow").Table | null>}
 */
export async function local_query(sql) {
	// After this point, the database has been initialized
	if (!db) await initDB();
	// We need to wait for tables to be available
	await withTimeout(tablesPromise);

	// Now we can safely execute our query
	console.log(`"*** Running local query *** ${sql}:"`);
	const res = await connection.query(sql).then((response) => {
		console.log(`Received local response: ${response}`);
		return arrowTableToJSON(response);
	  });
	console.log(`"Result for local query ${sql}:"`, res);
	return res;
}

/**
 * Queries the database with the given SQL statement.
 *
 * @param {string} sql
 * @returns {Promise<import("apache-arrow").Table | null>}
 */
export async function query(sql) {
	console.log(`"*** Running MD query *** ${sql}:"`);
	try {
		const res = await md_connection.evaluateStreamingQuery(sql).then((response) => {
			console.log(`*** Received MD response *** ${sql}`, response);
				return response.arrowStream.readAll();
		  }).then((arrowStream) => {
			const table = new Table(arrowStream);
			console.log(`*** Received MD table *** ${sql}`, table);
			return table;
		  });
		console.log(`*** Result for MD query ***: ${sql}`, res);
		return res;
	} catch (err) {
		console.log(`*** MD Query failed ***: ${sql}`, err);
		return local_query(sql);
	}
}

export { arrowTableToJSON, apacheToEvidenceType };
