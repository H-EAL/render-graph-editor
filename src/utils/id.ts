import { v4 as uuidv4 } from 'uuid';

export function newId(): string {
  return uuidv4();
}

export function shortId(): string {
  return uuidv4().slice(0, 8);
}
