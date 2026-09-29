import type {
  OfficeSaveIntent,
  OfficeSaveReceipt,
  OfficeSaveTransport,
  OfficeSerializedOutput,
  OfficeUploadReceipt,
  StableSnapshot,
} from "./host-contract";

export interface FakeOfficeTransport<TSnapshot> extends OfficeSaveTransport<TSnapshot> {
  serializeCalls: number;
  uploadCalls: number;
  commitCalls: number;
  reconcileCalls: number;
  serializedOutput: OfficeSerializedOutput;
  uploadReceipt: OfficeUploadReceipt;
  commitResponse: unknown;
  reconcileResponse: unknown;
}

export function createFakeOfficeTransport<TSnapshot>(options: {
  serializedOutput?: OfficeSerializedOutput;
  uploadReceipt?: OfficeUploadReceipt;
  commitResponse?: unknown;
  reconcileResponse?: unknown;
} = {}): FakeOfficeTransport<TSnapshot> {
  const fake: FakeOfficeTransport<TSnapshot> = {
    serializeCalls: 0,
    uploadCalls: 0,
    commitCalls: 0,
    reconcileCalls: 0,
    serializedOutput: options.serializedOutput ?? { data: new Uint8Array([1]), checksumSha256: "sha", sizeBytes: 1, format: "md" },
    uploadReceipt: options.uploadReceipt ?? { uploadId: "upload-1", checksumSha256: "sha", sizeBytes: 1, claimExpiresAt: "2099-01-01T00:00:00Z" },
    commitResponse: options.commitResponse ?? null,
    reconcileResponse: options.reconcileResponse ?? null,
    async serialize(_input: { intent: OfficeSaveIntent<TSnapshot>; snapshot: StableSnapshot<TSnapshot> }) {
      fake.serializeCalls += 1;
      return fake.serializedOutput;
    },
    async upload(_input: { intent: OfficeSaveIntent<TSnapshot>; output: OfficeSerializedOutput }) {
      fake.uploadCalls += 1;
      return fake.uploadReceipt;
    },
    async commit(_input: { intent: OfficeSaveIntent<TSnapshot>; upload: OfficeUploadReceipt }) {
      fake.commitCalls += 1;
      return fake.commitResponse;
    },
    async reconcile(_input: { intent: OfficeSaveIntent<TSnapshot> }) {
      fake.reconcileCalls += 1;
      return fake.reconcileResponse;
    },
  };
  return fake;
}

