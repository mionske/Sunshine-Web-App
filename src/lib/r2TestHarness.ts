// Test-only in-memory fake of the R2Bucket methods this app actually calls
// (put/get/delete) — matches FakeSpreadsheet's philosophy of never hitting
// a real external service in tests. Not exported from any package barrel;
// import directly from this file in tests.

interface FakeR2Object {
	body: ArrayBuffer;
	httpMetadata?: { contentType?: string };
}

export class FakeR2Bucket {
	objects = new Map<string, FakeR2Object>();

	async put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<void> {
		this.objects.set(key, { body: value, httpMetadata: options?.httpMetadata });
	}

	async get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null> {
		const object = this.objects.get(key);
		if (!object) return null;
		return { body: new Blob([object.body]).stream(), httpMetadata: object.httpMetadata };
	}

	async delete(key: string): Promise<void> {
		this.objects.delete(key);
	}
}

export function installFakeR2(): FakeR2Bucket {
	return new FakeR2Bucket();
}
