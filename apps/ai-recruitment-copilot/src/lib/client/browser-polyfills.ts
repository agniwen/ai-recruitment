import { installRandomUUIDPolyfill } from "./random-uuid";

// HTTP private-IP pages expose getRandomValues but may omit randomUUID.
// Run before React Start imports initialize any feature modules.
installRandomUUIDPolyfill(globalThis.crypto);
