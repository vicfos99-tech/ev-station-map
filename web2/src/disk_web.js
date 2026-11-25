// 바탕(플랫폼): 폰·PC 브라우저의 앱 전용 파일 자리(브라우저 개인 파일 저장소, OPFS)에 폴더·파일 쓰기.
// Logger(로그 폴더)와 Store(데이터 폴더)가 저마다 자기 폴더를 이것으로 쓴다 — 둘은 서로 모른다(설계 5-3).
// 시험 때는 같은 꼴(append·read·write)의 가짜로 바꿔 끼운다.
export const NEEDS = ['storage'];

export function createWebDisk(deps) {
  const storage = deps.storage;
  async function fileHandle(dir, file) {
    if (!storage || typeof storage.getDirectory !== 'function') throw new Error('storage');
    const root = await storage.getDirectory();
    const folder = await root.getDirectoryHandle(dir, { create: true });
    return folder.getFileHandle(file, { create: true });
  }
  return {
    async append(dir, file, text) {
      const h = await fileHandle(dir, file);
      const size = (await h.getFile()).size;
      const w = await h.createWritable({ keepExistingData: true });
      try {
        await w.seek(size);
        await w.write(text);
      } finally {
        await w.close();
      }
    },
    async read(dir, file) {
      const h = await fileHandle(dir, file);
      return (await h.getFile()).text();
    },
    async write(dir, file, text) {
      const h = await fileHandle(dir, file);
      const w = await h.createWritable({ keepExistingData: false });
      try {
        await w.write(text);
      } finally {
        await w.close();
      }
    },
  };
}
