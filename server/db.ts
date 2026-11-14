import 'dotenv/config';
import { MongoClient, type Db, type Document } from 'mongodb';
import type { Step } from './domain';

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI is not set (put it in .env)');

export const client = new MongoClient(uri, { appName: 'one-lesson' });
export const DB_NAME = process.env.DB_NAME ?? 'one_lesson';

let db: Db | null = null;
export async function getDb(): Promise<Db> {
  if (!db) {
    await client.connect();
    db = client.db(DB_NAME);
  }
  return db;
}

export type LessonStatus = 'trial' | 'proven' | 'rolled_back' | 'forgotten';
export const GOOD_STATUSES: LessonStatus[] = ['trial', 'proven'];

export interface Lesson extends Document {
  _id: string;
  skillKey: string;
  version: number;
  title: string;
  steps: Step[];
  tags: string[];
  teacherId: string;
  teacherName: string;
  teacherVerified: boolean;
  parentId: string | null;
  status: LessonStatus;
  embedding: number[];
  createdAt: Date;
  expiresAt: Date | null;
  provenRuns: number;
}

export interface Home extends Document {
  _id: string;
  name: string;
  hood: string;
  hasKids: boolean;
  blockedTags: string[];
  mapX: number;
  mapY: number;
  layout: { id: string; type: string; x: number; y: number }[];
  online: boolean;
  resumeToken: unknown | null;
  activeLessons: Record<string, string>;
}

export interface FleetEvent extends Document {
  type: 'published' | 'delivered' | 'refused' | 'ran' | 'rolled_back' | 'reverted' | 'caught_up' | 'forgotten' | 'asked';
  lessonId?: string;
  homeId?: string;
  teacherId?: string;
  rule?: string;
  detail?: Record<string, unknown>;
  at: Date;
}

export async function collections() {
  const d = await getDb();
  return {
    homes: d.collection<Home>('homes'),
    teachers: d.collection<Document>('teachers'),
    lessons: d.collection<Lesson>('lessons'),
    runs: d.collection<Document>('runs'),
    events: d.collection<FleetEvent>('events'),
    receipts: d.collection<Document>('receipts'),
  };
}
