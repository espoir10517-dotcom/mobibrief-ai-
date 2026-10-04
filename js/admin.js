// 관리자 모드: MY NEWS 탭은 관리자 휴대폰에서만 보입니다.
// 설정 화면 맨 아래 버전 글자를 5번 누르면 관리자 코드 입력칸이 나타납니다.
// 코드는 원문 대신 해시값만 저장되어 있습니다. 코드를 바꾸려면 README '관리자 모드' 안내를 참고하세요.
// ※ 화면에서 메뉴를 숨기는 기능이며, MY NEWS 의 내용은 모두 공개 뉴스라 보안 기능은 아닙니다.

const ADMIN_HASH = '4fc4df2dc6086e4a4c4bf6a80813449718cbd86e3692360e9734a9ed9d7d8d00';

export async function verifyAdminCode(code) {
  try {
    const data = new TextEncoder().encode(`mobibrief:${String(code).trim()}`);
    const buf = await crypto.subtle.digest('SHA-256', data);
    const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return hex === ADMIN_HASH;
  } catch {
    return false;
  }
}
