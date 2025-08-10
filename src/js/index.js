import './libs/01_vendor.min.js';
import './apps/main';
import '../css/scss/project.scss';

// 이미지 파일 모두 import
function importAll(r) {
  r.keys().forEach(r);
}

// ../img 폴더 안에서 inline-svg, sprite-common 제외하고 png, jpg, jpeg, svg, webp 가져오기
importAll(
  require.context(
    '../img',
    true,
    /^((?!inline-svg|sprites-common).)*\.(png|jpe?g|svg|webp)$/i
  )
);

console.log('📦 JS & 이미지 빌드 완료');