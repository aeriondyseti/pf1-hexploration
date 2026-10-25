// Minimal ambient declarations for the Foundry v13 and pf1 client globals.
// No Foundry type package is used (see TECH-DEBT): these are deliberately loose.
// The engine (src/engine/) must not reference any of them (invariant 3).
/* eslint-disable no-var */
declare var game: any;
declare var canvas: any;
declare var foundry: any;
declare var Hooks: any;
declare var CONFIG: any;
declare var CONST: any;
declare var ChatMessage: any;
declare var Roll: any;
declare var PIXI: any;
declare var Actor: any;
declare var Item: any;
declare var RollTable: any;
declare var pf1: any;
declare function fromUuid(uuid: string): Promise<any>;
declare function fromUuidSync(uuid: string): any;
