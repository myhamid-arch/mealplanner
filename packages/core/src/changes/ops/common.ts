// Shared payload fragments.
import { z } from "zod";

export const id = z.uuid();
export const isoDate = z.iso.date();
export const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/, "HH:MM:SS");
export const weekday = z.number().int().min(0).max(6);
export const grams = z.number().nonnegative().max(9_999_999);
export const share01 = z.number().min(0).max(1);
export const slotKey = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
