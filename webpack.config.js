const path = require('path');
const fs = require('fs-extra');
const cheerio = require('cheerio');
const glob = require('glob');
const crypto = require('crypto');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const BrowserSyncPlugin = require('browser-sync-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const SpritesmithPlugin = require('webpack-spritesmith');
const ImageMinimizerPlugin = require('image-minimizer-webpack-plugin');

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
            metaDataArr.sort((a, b) => {
              const extractNumbers = (filename) =>
                filename
                  .split('_')
                  .map(part => parseInt(part, 10))
                  .filter(num => !isNaN(num));
  
              const numsA = extractNumbers(a.name);
              const numsB = extractNumbers(b.name);
              const len = Math.max(numsA.length, numsB.length);
              for (let i = 0; i < len; i++) {
                const valA = numsA[i] ?? 0;
                const valB = numsB[i] ?? 0;
                if (valA !== valB) return valA - valB;
              }
              return 0;
            });            
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
      filename: 'project.bundle.js', // 메인 JS 엔트리
      path: path.resolve(__dirname, 'dist'),
      assetModuleFilename: (pathData) => {
        const relativePath = path.relative(path.resolve(__dirname, 'src'), pathData.filename);
        if (relativePath.startsWith('fonts/')) {
          return `asset/fonts/[name][ext]`; // 폰트 파일은 dist/asset/fonts로 이동
        }
        return `img/[path][name][ext]`; // 그 외는 img/ 하위로
      },
      clean: true // 빌드 전에 dist 정리 > 다 지워버리므로 변경사항만 반영되게 추가설정 필요
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
          test: /\.(png|jpe?g|gif|svg|webp)$/i,
          type: 'asset/resource', // webpack5 표준 이미지 처리 방식
          generator: {
            filename: (pathData) => {
              const relativePath = path.relative(path.resolve(__dirname, 'src/img'), pathData.filename);
              if (relativePath.startsWith('sprite-common/') || relativePath.startsWith('inline-svg/')) {
                return ''; // 제외할 폴더의 이미지는 빌드하지 않음
              }
              return `img/${relativePath}`;
            },
          },
          exclude: [
            path.resolve(__dirname, 'src/img/sprites-common'),
            path.resolve(__dirname, 'src/img/inline-svg'),
            path.resolve(__dirname, 'src/fonts'), // 폰트 폴더 제외
          ],      
        },
        {
          test: /\.svg$/i, // 일반 SVG 파일은 별도로 처리 (inline-svg 제외)
          type: 'asset/resource',
          generator: {
            filename: (pathData) => {
              const relativePath = path.relative(path.resolve(__dirname, 'src/img'), pathData.filename);
              if (relativePath.startsWith('inline-svg/')) {
                return ''; // inline-svg 폴더의 SVG는 빌드하지 않음
              }
              return `img/${relativePath}`;
            },
          },
          exclude: [
            path.resolve(__dirname, 'src/img/inline-svg'),
          ],
        },
        {
          test: /\.(woff|woff2|ttf|otf|eot)$/i,
          type: 'asset/resource',
          generator: {
            filename: 'asset/fonts/[name][ext]', // 폰트 파일은 dist/asset/fonts로
          },
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
        },
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
        files: ['./dist/**/*.html'], // HTML만 감시
        server: { baseDir: ['dist'] }
      }),
      new ImageMinimizerPlugin({
        minimizer: {
          implementation: ImageMinimizerPlugin.imageminGenerate,
          options: {
            plugins: [
              ['gifsicle', {interlaced: true}],
              ['mozjpeg', {quality:80}],
              ['optipng', {optimizationLevel:5}],
              ['svgo', {
                plugins: [
                  {name: 'removeViewBox', active: true},
                  {name: 'removeDimensions', active: false}
                ],
              }],
            ]
          }
        }
      }),
      new CopyWebpackPlugin({
        patterns : [
          {
            from: path.resolve(__dirname, 'src/fonts'),
            to: path.resolve(__dirname, 'dist/asset/fonts'),
          },
          {
            from: path.resolve(__dirname, 'src/video'),
            to: path.resolve(__dirname, 'dist/asset/video'),
          },
        ],
      }),
      // inline SVG 
      new InlineSvgScssPlugin(),
      // PNG Sprite
      new SpritesmithPlugin({
        src: {
          cwd: path.resolve(__dirname, 'src/img/sprites-common'),
          glob:'*.png'
        },
        target: {
          image: path.resolve(__dirname, 'src/img/sprite/sprite.png'), // png 합친 파일
          css: [
            [
              path.resolve(__dirname, 'src/css/scss/sprites/_sprites.scss'),
              {format: 'scss_template'}
            ]
          ]
        },
        customTemplates: {
          scss_template: path.resolve(__dirname, 'src/css/scss/sprites/_sprite-template.handlebars')
        },
        apiOptions: {
          cssImageRef: '~img/sprite/sprite.png' // 합쳐진 스프라이트 이미지를 불러올 경로
        }
      }),
    ],
    resolve :{
      modules: ['node_modules', 'src']
    },
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
      // SCSS 감시는 webpack-dev-server만
      watchFiles: ['src/**/*', 'index.html', '!src/css/**/*.scss', '!src/css/scss/inline-svg/_inline-svg-data.scss'],
    },
  }
};