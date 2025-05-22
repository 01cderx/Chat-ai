import {neon} from "@neondatabase/serverless";
import {drizzle} from "drizzle-orm/neon-http";
import { config } from "dotenv";

// Load environment variable from .env file
config({path: '.env'});

if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not defined');
}

// Initialize Neon database connection
const sql = neon(process.env.DATABASE_URL);

// Initialize Drizzle ORM with Neon
export const db = drizzle(sql);

