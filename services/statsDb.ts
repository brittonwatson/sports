
import { TeamStatItem } from "../types";

const DB_NAME = 'ProbabilisDB';
const STORE_NAME = 'team_stats';
const VERSION = 2; // Incremented to force schema upgrade/clear

interface StoredStats {
    id: string; // key: `${sport}-${teamId}`
    sport: string;
    teamId: string;
    stats: TeamStatItem[];
    timestamp: number;
}

// Simple event bus for DB updates
export const dbEvents = new EventTarget();

const openDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) {
            reject(new Error("IndexedDB not supported"));
            return;
        }
        const request = window.indexedDB.open(DB_NAME, VERSION);
        
        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            // Clear old data if upgrading from version 1 (or any older version)
            if (event.oldVersion < 2) {
                if (db.objectStoreNames.contains(STORE_NAME)) {
                    db.deleteObjectStore(STORE_NAME);
                }
            }
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                store.createIndex('sport', 'sport', { unique: false });
            }
        };
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

export const saveStatsBatch = async (items: StoredStats[]): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        
        items.forEach(item => store.put(item));
        
        tx.oncomplete = () => {
            // Notify listeners that stats have been updated
            dbEvents.dispatchEvent(new CustomEvent('stats_updated', { detail: { sport: items[0]?.sport } }));
            resolve();
        };
        tx.onerror = () => reject(tx.error);
    });
};

export const getStatsBySport = async (sport: string): Promise<StoredStats[]> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('sport');
        const request = index.getAll(IDBKeyRange.only(sport));
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

export const getTeamStats = async (sport: string, teamId: string): Promise<StoredStats | undefined> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(`${sport}-${teamId}`);
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

export const clearStatsBySport = async (sport: string): Promise<void> => {
    // Optional helper if we want to manually clear specific sports later
    return Promise.resolve();
};
