import fetch from "cross-fetch"
import { initializeApp } from "firebase/app"
import {
  connectFirestoreEmulator,
  getFirestore,
} from "firebase/firestore"

type SetupTeardownFunction = (
  callback: () => void | Promise<void>
) => void

const FIRESTORE_EMULATOR_HOST = "127.0.0.1"
const FIRESTORE_EMULATOR_PORT = 5002
const FIRESTORE_PROJECT = "use-firestore-test"

export const testApp = initializeApp({
  projectId: FIRESTORE_PROJECT,
})

export function connectToEmulators(
  beforeAll: SetupTeardownFunction,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  afterAll: SetupTeardownFunction
) {
  beforeAll(async () => {
    await fetch(
      `http://${FIRESTORE_EMULATOR_HOST}:${FIRESTORE_EMULATOR_PORT}/emulator/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents`,
      {
        method: "DELETE",
      }
    )

    connectFirestoreEmulator(
      getFirestore(testApp),
      FIRESTORE_EMULATOR_HOST,
      FIRESTORE_EMULATOR_PORT
    )
  })
}
