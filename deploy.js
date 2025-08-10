const ghpages = require('gh-pages');
const gitRepoInfo = require('git-repo-info');
const info = gitRepoInfo();

const args = process.argv.slice(2); // -- 이후 인자만 추출
const msgIndex = args.indexOf('--message');
const message = msgIndex !== -1 && args[msgIndex + 1]
  ? args[msgIndex + 1]
  : `[DEPLOY] ${info.commitMessage}`;

ghpages.publish('dist', {
  branch: 'main',
  message: message,
}, (err) => {
  if (err) {
    console.error('배포 실패:', err);
  } else {
    console.log('배포 성공! 🎉');
  }
});