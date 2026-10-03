import { ObjectLiteral } from 'typeorm';

/**
 * A constructable entity class. The tenant decorator lives on the class, so string
 * names and `EntitySchema` targets are intentionally not accepted.
 */
export type EntityClass<E extends ObjectLiteral = ObjectLiteral> = new (...args: never[]) => E;
