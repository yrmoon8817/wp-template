const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const BrowserSyncPlugin = require('browser-sync-webpack-plugin');
const cheerio = require('cheerio');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const fs = require('fs-extra');
const glob = require('glob');
const crypto = require('crypto');

const generateHTML = async() => {
  let projectJson = JSON.parse(await fs.promises.readFile('templates/projectInfo.json', 'utf-8'));
  let projectInfo = {
    projectName: projectJson.project_name,
    projectAuthor: projectJson.author,
    projectOrg: projectJson.organization
  };
  return {
    project: projectInfo,
    files: [],
  };
}

class RenderHtmlListPlugin {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap('RenderHtmlListPlugin',
      (compilation)=>{
        let metaDataArr = [];
        HtmlWebpackPlugin.getHooks(compilation).beforeEmit.tapAsync(
          'RenderHtmlListPlugin',
          (data, callback) => {
            // index.html은 제외
            if (data.plugin.options.filename === 'index.html'){
              callback(null);
              return;
            }
            // HTML 내용 파싱
            const $ = cheerio.load(data.html);
            let wholeTitle = $('meta[name="list"]').attr('content') || $('title').text();
            let splitTitle = wholeTitle.split(' : ');
            let pageStatus = $('body').data('pagestatus');
            let splitStatus = pageStatus? pageStatus.split(' : ') : null;

            // 메타 데이터 구성
            const fileData = {
              title: splitTitle[0] || '',
              name: path.basename(data.plugin.options.filename),
              category: path.basename(data.plugin.options.filename).substring(0,2),
              categoryText: splitTitle[1] || '',
              listTitle: wholeTitle,
              mdate: new Date(), // 소스 파일의 mtime을 사용할 경우
              directory: data.plugin.options.filename,
              filename: path.basename(data.plugin.options.filename)
            };
            if (splitStatus) {
              fileData.splitStatus = splitStatus[0];
              fileData.splitStatusDate = splitStatus[1];
            }

            if($('meta[name="list"]').length) {
              $('meta[name="list"]').remove();
              data.html = $.html({ decodeEntities: false});
            }

            // 메타 데이터 저장
            metaDataArr.push(fileData);
            callback(null);
          }
        );

        // index.html 의 templateParameter 수정
        HtmlWebpackPlugin.getHooks(compilation).alterAssetTagGroups.tapAsync(
          'RenderHtmlListPlugin',
          (data, callback) => {
            // index.html에 적용
            if (data.plugin.options.filename !== 'index.html'){
              callback(null);
              return;
            }
            // metaDataArr 을 templateParameters에 추가
            data.plugin.options.templateParameters = {
              ...data.plugin.options.templateParameters,
              fileInfo: {
                files: metaDataArr.reduce((acc, file) => {
                  // theme = views의 하위 폴더
                  const theme = path.dirname(file.directory).split(path.sep)[1]
                  let group = acc.find(g => g[0].theme === theme);
                  if (!group) {
                    group = [{ theme }];
                    acc.push(group);
                  }
                  group.push(file);
                  return acc;
                }, [])
              },
            };
            callback(null);
          }
        )
      }
    )
  }
}
function toSnakeCase(name) {
  return name
  .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
  .replace(/[\s\-]+/g, '_')
  .replace(/_+/g, '_')
  .toLowerCase();
}

class InlineSvgScssPlugin {
  constructor(){
    this.cache = null;
  }
  apply(compiler) {
    compiler.hooks.beforeCompile.tapAsync('InlineSvgScssPlugin',
      (params, callback) => {
        const svgDir = path.resolve(__dirname, 'src/img/inline-svg');
        const outputPath = path.resolve(__dirname, 'src/css/scss/inline-svg/_inline-svg-data.scss');
        const svgFiles = glob.sync(`${svgDir}/*.svg`);

        if(!svgFiles.length) {
          callback();
          return;
        }
        // 캐싱
        const fileHashes = svgFiles.map((file) => { 
          const content = fs.readFileSync(file, 'utf8');
          return crypto.createHash('md5').update(content).digest('hex');
        });
        const combinedHash = crypto.createHash('md5').update(fileHashes.join('')).digest('hex');
        if(this.cache === combinedHash) {
          callback();
          return;
        }
        this.cache = combinedHash;

        let scssOutput = ``;
        svgFiles.forEach((file) => {
          let svgContent = fs.readFileSync(file, 'utf8');

          // svg 코드를 scss에서 사용할 수 있는 함수 형태로 변환
          // 변수 치환에서 작은따옴표의 짝이 맞지 않는 건 의도한 부분입니다.
          svgContent = svgContent
          .replace(/<\?xml[\s\S]*?\?>\s*/i, '') // 불필요한 코드 제거
          .replace(/<!DOCTYPE svg[\s\S]*?>\s*/i, '')  // 불필요한 코드 제거
          .replace(/<metadata>[\s\S]*?<\/metadata>\s*/i, '')  // 불필요한 코드 제거
          .replace(/[\r\n]+/g, ' ') // 줄바꿈을 공백으로 변경
          .replace(/</g, `%3C`) // 태그 특수문자 인코딩문자로 변경
          .replace(/>/g, `%3E`) // 태그 특수문자 인코딩문자로 변경
          .replace(/"/g, `\'`)  // 큰따옴표를 작은따옴표로 모두 변경 -- 바꾸지 않으면 에러남
          .replace(/stroke='#[0-9a-fA-F]{6}|none'/g, `#{$strokecolor}'`)  // stroke 컬러 변수치환
          .replace(/(%3Ccircle\b[^>]*?)\sfill='(#([0-9a-fA-F]{6})|none)'/g, `$1 fill='#{$circlefillcolor}'`)  // circle요소의 fill 컬러 변수치환
          .replace(/fill='#[0-9a-fA-F]{6}|none'/g, `fill='#{$fillcolor}`) // fill 컬러 변수치환, circle 다음으로 처리

          // inline svg function 생성
          const fileName = path.basename(file, '.svg');
          const functionName = toSnakeCase(fileName);
          
          scssOutput += `@function ${functionName}($fillcolor, $circlefillcolor, $strokecolor){\n`;
          scssOutput += ` @return "data:image/svg+xml, ${svgContent}";\n`;
          scssOutput += `}\n`;
        });
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, scssOutput);

        callback();
      }
    );
  }
}

module.exports = async () => {
  const info = await generateHTML();
  const htmlEl = [];
  const seen = new Set();
  const dirPath = 'src/views/';

  try {
    const pathArr = await fs.promises.readdir(dirPath);
    for (const theme of pathArr) {
      const files = await fs.promises.readdir(path.join(dirPath, theme));
      const htmlFiles = files.filter(file => file.endsWith('.html'));
      for (const file of htmlFiles) {
        const dir = `src/views/${theme}`;
        const dir2 = `views/${theme}`;
        const key = `${dir2}/${file}`;
        if(!seen.has(key)){
          seen.add(key);
          htmlEl.push({ file, dir, dir2 });
        }
      }
    }
  } catch (err) {
    console.error('Error reading src/views', err);
  }
  let entryPath = './src/js/index.js';
  return {
    entry: entryPath,
    mode: 'none',
    output: {
      filename: 'project.bundle.js',
      path: path.resolve(__dirname, 'dist'),
      clean: true
    },
    module: {
      rules: [
        {
          test: /\.(ejs|html)$/i,
          use: [
            {
              loader: 'ejs-easy-loader',
            }
          ]
        },
        {
          test: /\.js$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env']
            }
          }
        },
        {
          test: /\.scss$/,
          use: [
            'style-loader',
            'css-loader',
            'sass-loader'
          ]
        }
      ]
    },
    plugins: [
      ...htmlEl.map((el) => {
        return new HtmlWebpackPlugin({
          template: path.resolve(el.dir, el.file), 
          filename: path.join(`./${el.dir2}`, el.file)
        });
      }),
      new HtmlWebpackPlugin({
        template: './index.html',
        filename: 'index.html',
        templateParameters: {
          info, 
          project: {
            projectName: info.project.projectName,
            projectOrg: info.project.projectOrg,
            projectAuthor: info.project.projectAuthor
          },
        },
      }),
      new RenderHtmlListPlugin(),
      new BrowserSyncPlugin({
        host: 'localhost',
        port: 3030,
        files: ['./dist/**/*.html'],
        server: { baseDir: ['dist'] } // server base directory
      }),
      new CopyWebpackPlugin({
        patterns : [
          {
            from: path.resolve(__dirname, 'src/fonts'),
            to: path.resolve(__dirname, 'dist/asset/fonts'),
          },
          {
            from: path.resolve(__dirname, 'src/img/common'),
            to: path.resolve(__dirname, 'dist/asset/img/common'),
          }, 
          {
            from: path.resolve(__dirname, 'src/img/svg'),
            to: path.resolve(__dirname, 'dist/asset/img/svg'),
          }, 
          {
            from: path.resolve(__dirname, 'src/video'),
            to: path.resolve(__dirname, 'dist/asset/video'),
          },
        ],
      }),
      new InlineSvgScssPlugin()
    ],
    devServer: {
      static: {
        directory: path.join(__dirname, 'dist'),
      },
      devMiddleware: {
        writeToDisk: true // scss 파일 자동 작성시 필요한 옵션
      },
      compress:true,
      open: false,
      hot: true,
      liveReload: true,
      historyApiFallback: {
        index: '/index.html',
      },
      watchFiles: ['src/*', 'index.html', '!src/css/scss/inline-svg/_inline-svg-data.scss'],
    },
    watchOptions: {
      ignored: /node_modules/,
      aggregateTimeout: 300,
      poll: 1000
    },
  }
};