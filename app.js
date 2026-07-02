/**
 * Scratch .sb3 Analyzer - app.js
 * 
 * Scratch .sb3 ファイルから project.json を抽出し、
 * LLM用プロンプトの生成、および修正後のJSONからの再エンコードを行います。
 * 小学生向けにステップバイステップ（一本道）で進められるUXになっています。
 */

// 解析データの一時格納用
let currentProjectJsonText = '';
let originalZip = null;
let originalFileName = '';
let originalParsedJson = null;

// UI読み込み完了後の処理
document.addEventListener('DOMContentLoaded', () => {
  // STEP 1 エレメント
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const fileInfo = document.getElementById('file-info');

  // STEP 2 エレメント
  const customQuestionContainer = document.getElementById('custom-question-container');
  const customQuestion = document.getElementById('custom-question');
  const customSubmitBtn = document.getElementById('custom-submit-btn');

  // STEP 3 エレメント
  const promptOutput = document.getElementById('prompt-output');
  const copyPromptBtn = document.getElementById('copy-prompt-btn');

  // STEP 4 エレメント
  const modifiedJsonInput = document.getElementById('modified-json-input');
  const downloadSb3Btn = document.getElementById('download-sb3-btn');

  // 完了メッセージ
  const completionMessage = document.getElementById('completion-message');
  const downloadCompletionMessage = document.getElementById('download-completion-message');

  // ==========================================
  // ステップ状態制御ヘルパー
  // ==========================================
  function setStepState(stepNum, state) {
    const stepEl = document.getElementById(`step-${stepNum}`);
    if (!stepEl) return;

    const statusIconEl = stepEl.querySelector('.step-status-icon');

    // クラスのリセット
    stepEl.classList.remove('active', 'disabled', 'completed');

    if (state === 'disabled') {
      stepEl.classList.add('disabled');
      if (statusIconEl) statusIconEl.textContent = '🔒';
      // 内部の入力要素を無効化
      stepEl.querySelectorAll('input, select, textarea, button').forEach(el => {
        if (el.id !== 'file-input') el.setAttribute('disabled', 'true');
      });
    } else if (state === 'active') {
      stepEl.classList.add('active');
      if (statusIconEl) statusIconEl.textContent = '⏳';
      // 内部の入力要素を有効化
      stepEl.querySelectorAll('input, select, textarea, button').forEach(el => {
        el.removeAttribute('disabled');
      });
    } else if (state === 'completed') {
      stepEl.classList.add('completed');
      if (statusIconEl) statusIconEl.textContent = '✅';
      // 完了したステップの入力は有効にしておく（微調整できるように）
      stepEl.querySelectorAll('input, select, textarea, button').forEach(el => {
        el.removeAttribute('disabled');
      });
    }
  }

  // 初期状態の設定
  setStepState(1, 'active');
  setStepState(2, 'disabled');
  setStepState(3, 'disabled');
  setStepState(4, 'disabled');

  // ==========================================
  // STEP 1: ファイルアップロード処理
  // ==========================================
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  });

  dropZone.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFile(e.target.files[0]);
    }
  });

  function handleFile(file) {
    if (!file.name.endsWith('.sb3')) {
      alert('スクラッチのファイル（.sb3）をえらんでね！');
      return;
    }

    originalFileName = file.name;

    const reader = new FileReader();
    reader.onload = async function(e) {
      try {
        const arrayBuffer = e.target.result;
        originalZip = await JSZip.loadAsync(arrayBuffer);
        const projectJsonFile = originalZip.file('project.json');
        
        if (!projectJsonFile) {
          throw new Error('project.json が見つかりませんでした。ただしいファイルか確認してね。');
        }

        const projectJsonText = await projectJsonFile.async('text');
        
        // JSONのパース
        const parsedJson = JSON.parse(projectJsonText);
        originalParsedJson = parsedJson;
        currentProjectJsonText = JSON.stringify(parsedJson, null, 2);
        
        // UIのカード更新
        fileInfo.innerHTML = `
          <div class="file-card">
            <span class="file-icon">📄</span>
            <div class="file-details">
              <div class="file-name">${file.name}</div>
              <div class="file-size">${(file.size / (1024 * 1024)).toFixed(2)} MB</div>
            </div>
          </div>
        `;

        // 状態遷移: STEP 1 完了 -> STEP 2 開始
        setStepState(1, 'completed');
        setStepState(2, 'active');
        
        // プロンプトの初期更新
        updatePromptOutput();

        // スムーズスクロール
        setTimeout(() => {
          document.getElementById('step-2').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);

      } catch (err) {
        console.error(err);
        alert('ファイルをよみこむときにエラーがおきたよ: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // ==========================================
  // STEP 2: AIに聞きたいことのラジオボタンイベント
  // ==========================================
  const templateRadios = document.querySelectorAll('input[name="template"]');
  templateRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      // 自由記述エリアの表示・非表示
      if (radio.value === 'custom-ask' || radio.value === 'custom-fix') {
        customQuestionContainer.classList.remove('hidden');
        
        // placeholderを選択肢に合わせて変更
        if (radio.value === 'custom-ask') {
          customQuestion.placeholder = 'AIにしつもんしたいことをここに書いてね... (お返事は「ぶんしょう」でもらいます)';
        } else {
          customQuestion.placeholder = 'AIになおしてほしいことや、かいぞうしてほしいことをここに書いてね... (お返事は「プログラム」でもらいます)';
        }

        // 自由記述のときは自動遷移しない (決定ボタンを押すまでSTEP 3をdisabledにする)
        setStepState(3, 'disabled');
      } else {
        customQuestionContainer.classList.add('hidden');
        
        // 質問の種類に応じてSTEP 4の表示非表示を切り替える
        const isCodeOutput = (radio.value === 'bug-fix' || radio.value === 'improve');
        const step4 = document.getElementById('step-4');

        if (isCodeOutput) {
          step4.classList.remove('hidden');
          completionMessage.classList.add('hidden');
          downloadCompletionMessage.classList.add('hidden');
        } else {
          step4.classList.add('hidden');
          completionMessage.classList.add('hidden');
          downloadCompletionMessage.classList.add('hidden');
        }

        // プロンプトを更新
        updatePromptOutput();

        // 状態遷移: STEP 2 完了 -> STEP 3 開始 (自動遷移)
        setStepState(2, 'completed');
        setStepState(3, 'active');

        // スムーズスクロール
        setTimeout(() => {
          document.getElementById('step-3').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      }
    });
  });

  // 「自分でしつもんを書く」の完了ボタンクリック時
  customSubmitBtn.addEventListener('click', () => {
    const questionVal = customQuestion.value.trim();
    if (!questionVal) {
      alert('AIにききたいことを書いてね！');
      return;
    }

    const selectedRadio = document.querySelector('input[name="template"]:checked');
    const selectedTemplate = selectedRadio ? selectedRadio.value : '';

    // 自由記述用のプロンプトを更新
    updatePromptOutput();

    // 質問の種類（custom-fix / custom-ask）に応じて STEP 4 を出し分け
    const isCodeOutput = (selectedTemplate === 'custom-fix');
    const step4 = document.getElementById('step-4');

    if (isCodeOutput) {
      step4.classList.remove('hidden');
      completionMessage.classList.add('hidden');
      downloadCompletionMessage.classList.add('hidden');
    } else {
      step4.classList.add('hidden');
      completionMessage.classList.add('hidden');
      downloadCompletionMessage.classList.add('hidden');
    }

    // 状態遷移: STEP 2 完了 -> STEP 3 開始
    setStepState(2, 'completed');
    setStepState(3, 'active');

    // スムーズスクロール
    setTimeout(() => {
      document.getElementById('step-3').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  });

  customQuestion.addEventListener('input', updatePromptOutput);

  // AI送信用のJSONデータをスリム化（アセットのバイナリをダミー化）する関数
  function getSlimProjectJson() {
    if (!originalParsedJson) return '';
    
    // ディープコピー
    const slimJson = JSON.parse(JSON.stringify(originalParsedJson));
    
    if (slimJson.targets && Array.isArray(slimJson.targets)) {
      slimJson.targets.forEach(target => {
        // AIに「スプライトがある」と認識させるため、
        // アセットの【名前】のみを残し、ハッシュ値など重い情報はダミー化して文字数を激減させる
        if (target.costumes && Array.isArray(target.costumes)) {
          target.costumes = target.costumes.map(c => ({
            name: c.name || "costume1",
            dataFormat: c.dataFormat || "png",
            assetId: "dummy",
            md5ext: `dummy.${c.dataFormat || "png"}`
          }));
        } else {
          target.costumes = [{ name: "costume1", dataFormat: "png", assetId: "dummy", md5ext: "dummy.png" }];
        }

        // 音データも名前だけ残してダミー化
        if (target.sounds && Array.isArray(target.sounds)) {
          target.sounds = target.sounds.map(s => ({
            name: s.name || "sound1",
            dataFormat: s.dataFormat || "wav",
            assetId: "dummy",
            md5ext: `dummy.${s.dataFormat || "wav"}`
          }));
        } else {
          target.sounds = [];
        }
      });
    }
    
    return JSON.stringify(slimJson, null, 2);
  }

  // プロンプト更新処理
  function updatePromptOutput() {
    if (!originalParsedJson) return;

    const selectedRadio = document.querySelector('input[name="template"]:checked');
    const selectedTemplate = selectedRadio ? selectedRadio.value : 'bug-find';

    let questionText = '';
    let formatRuleText = '';

    if (selectedTemplate === 'bug-find') {
      questionText = 'このスクラッチのプログラム（project.json）で、うごかないところ（バグ）や、バグになりうる不具合箇所があれば見つけて、その「場所（どのスプライトのどのブロックか）」と「原因」を教えてください。';
    } else if (selectedTemplate === 'bug-fix') {
      questionText = 'このスクラッチのプログラム（project.json）で、うごかないところ（バグ）を見つけて、プログラムがただしくうごくようになおしてください。';
    } else if (selectedTemplate === 'improve') {
      questionText = 'このプログラムをもっとおもしろくするための、演出（見た目）をはでにしたり、新しいボタンや機能をつけたりする改造を行ってください。';
    } else if (selectedTemplate === 'explain') {
      questionText = 'このプログラムがどうやってうごいているか、キャラクター（スプライト）ごとのやくわりについて、わかりやすく教えてください。';
    } else {
      // custom-ask もしくは custom-fix
      questionText = customQuestion.value || 'このプログラムについて、しじ通りに教えてください。';
    }

    const isCodeOutput = (selectedTemplate === 'bug-fix' || selectedTemplate === 'improve' || selectedTemplate === 'custom-fix');

    if (isCodeOutput) {
      formatRuleText = `【AIの先生へのルール（必ずまもってください）】
1. なおした・かいぞうした「project.json」の内容のみを出力してください。
2. 出力する文字数を極限まで少なくして途中で切れるのを防ぐため、以下のルールを必ず守ってください：
   - 変更（修正・改造）を加えたスプライトのみ、プログラム（blocks）を正しく記述してください。
   - 変更のない（元のプログラムのままでよい）スプライトは、プログラム（blocks）の中身を空オブジェクト \`{}\` に省略して出力してください。
3. 「はい、直しました」などのあいさつや、プログラムの説明は、一切書かないでください。
4. 出力するJSONコードは、以下のように \`\`\`json と \`\`\` でかこんで出力してください。

\`\`\`json
[ここになおしたJSONデータだけを入れてね]
\`\`\`
`;
    } else {
      formatRuleText = `【AIの先生へのルール（必ずまもってください）】
1. 小学生のユーザーにもわかりやすいやさしい日本語（ひらがな多め、わかりやすい言葉、やさしい口調）で、ていねいに説明してください。
2. スクラッチの「スプライトの名前」や「ブロックの名前」をしっかり出して説明してください。
3. 今回はプログラム（JSONコード）は出力しなくて大丈夫です。解説文だけを分かりやすく書いてください。
`;
    }

    // AIに送信するJSONをスリム化
    const slimJsonText = getSlimProjectJson();

    const promptText = `あなたはスクラッチのプログラミングを教えてくれる、やさしいAIの先生です。
小学生のユーザーが作ったスクラッチのプログラム（project.json）について、以下のようになおしたり、教えてあげたりしてください。

【しつもん・なおしてほしいこと】
${questionText}

${formatRuleText}

【元のプロジェクトデータ (project.json)】
※AIの出力がとちゅうで切れるのをふせぐため、画像や音のファイル名情報はダミーにして短くしてあります。
\`\`\`json
${slimJsonText}
\`\`\`
`;

    promptOutput.textContent = promptText;
  }

  // ==========================================
  // STEP 3: コピー処理 & 状態遷移
  // ==========================================
  copyPromptBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(promptOutput.textContent)
      .then(() => {
        const origText = copyPromptBtn.textContent;
        copyPromptBtn.textContent = 'コピーできたよ！ ✓';
        copyPromptBtn.classList.add('copied');
        
        // 状態遷移: STEP 3 完了
        setStepState(3, 'completed');

        const selectedRadio = document.querySelector('input[name="template"]:checked');
        const selectedTemplate = selectedRadio ? selectedRadio.value : 'bug-find';
        const isCodeOutput = (selectedTemplate === 'bug-fix' || selectedTemplate === 'improve' || selectedTemplate === 'custom-fix');

        if (isCodeOutput) {
          // プログラム返答が必要な場合 -> 直接 STEP 4 開始
          setStepState(4, 'active');
          setTimeout(() => {
            document.getElementById('step-4').scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 100);
        } else {
          // 文章返答の場合 -> お祝い完了メッセージを表示して終了
          completionMessage.classList.remove('hidden');
          setTimeout(() => {
            completionMessage.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 100);
        }

        setTimeout(() => {
          copyPromptBtn.textContent = origText;
          copyPromptBtn.classList.remove('copied');
        }, 2000);
      })
      .catch(err => {
        alert('コピーにしっぱいしたよ: ' + err);
      });
  });

  // ==========================================
  // STEP 4: 再エンコード & ダウンロード処理 & 完了表示
  // ==========================================
  downloadSb3Btn.addEventListener('click', async () => {
    const rawJsonInput = modifiedJsonInput.value.trim();
    if (!rawJsonInput) {
      alert('AIがなおしてくれたプログラムを貼りつけてね。');
      return;
    }

    // マークダウンコードブロックの閉じバッククォートが不足しているか検知
    const backtickCount = (rawJsonInput.match(/```/g) || []).length;
    const isUnfinishedCodeBlock = rawJsonInput.includes('```') && (backtickCount % 2 !== 0);

    // ```json と ``` を取り除くクレンジング処理
    let cleansedJson = rawJsonInput;
    if (cleansedJson.includes('```')) {
      const match = cleansedJson.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (match && match[1]) {
        cleansedJson = match[1].trim();
      } else {
        cleansedJson = cleansedJson.replace(/```(?:json)?/g, '').replace(/```/g, '').trim();
      }
    }

    // クレンジング後の末尾文字が閉じ括弧でないか検知
    const lastChar = cleansedJson.charAt(cleansedJson.length - 1);
    const isUnfinishedJson = lastChar !== '}' && lastChar !== ']';

    // パースを実行
    let parsedJson;
    try {
      parsedJson = JSON.parse(cleansedJson);
    } catch (err) {
      console.error(err);
      if (isUnfinishedCodeBlock || isUnfinishedJson) {
        alert('⚠️ AIのプログラムが とちゅうで切れてしまっている みたい！\n\nAIのチャットで「つづきを書いて」とたのむか、もういちどさいしょからしつもんしてみてね。');
      } else {
        alert('⚠️ プログラムのカタチが すこしおかしい みたい。\n\nAIがだしてくれたプログラム（JSONコード）を、のこさずコピーして貼りつけてね。\n（エラー: ' + err.message + '）');
      }
      return;
    }

    try {
      // ==========================================
      // 安全な逆マージ復元処理（元のJSONをベースにプログラムのみを上書き）
      // ==========================================
      const mergedJson = JSON.parse(JSON.stringify(originalParsedJson));

      if (parsedJson.targets && Array.isArray(parsedJson.targets)) {
        const aiTargetsMap = {};
        parsedJson.targets.forEach(target => {
          aiTargetsMap[target.name] = target;
        });

        // 元のスプライト構造に対して、AIが修正したロジックのみを書き換える
        mergedJson.targets.forEach(originalTarget => {
          const aiTarget = aiTargetsMap[originalTarget.name];
          if (aiTarget) {
            // AIが出力したスプライトのプログラム（blocks）が空でない場合のみ上書きする
            // （AIが「変更なし」として blocks: {} で省略出力してきた場合は元のプログラムをそのまま維持）
            if (aiTarget.blocks && Object.keys(aiTarget.blocks).length > 0) {
              originalTarget.blocks = aiTarget.blocks;
              if (aiTarget.variables) originalTarget.variables = aiTarget.variables;
              if (aiTarget.lists) originalTarget.lists = aiTarget.lists;
              if (aiTarget.comments) originalTarget.comments = aiTarget.comments;
              if (aiTarget.broadcasts) originalTarget.broadcasts = aiTarget.broadcasts;
              
              // スプライトの変更されうるプロパティの上書き
              if (aiTarget.x !== undefined) originalTarget.x = aiTarget.x;
              if (aiTarget.y !== undefined) originalTarget.y = aiTarget.y;
              if (aiTarget.direction !== undefined) originalTarget.direction = aiTarget.direction;
              if (aiTarget.visible !== undefined) originalTarget.visible = aiTarget.visible;
              if (aiTarget.size !== undefined) originalTarget.size = aiTarget.size;
              if (aiTarget.currentCostume !== undefined) originalTarget.currentCostume = aiTarget.currentCostume;
              if (aiTarget.volume !== undefined) originalTarget.volume = aiTarget.volume;
            }
          }
        });
      }
      
      // Zipに project.json を上書き
      originalZip.file('project.json', JSON.stringify(mergedJson));

      // 新しい .sb3 ファイル（Zipバイナリ）の生成
      const blob = await originalZip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      
      // ダウンロードの実行
      const a = document.createElement('a');
      const baseName = originalFileName ? originalFileName.substring(0, originalFileName.lastIndexOf('.')) : 'project';
      a.href = url;
      a.download = `${baseName}_modified.sb3`;
      
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      // 状態遷移: STEP 4 完了
      setStepState(4, 'completed');
      
      // 完了お祝いメッセージの表示
      downloadCompletionMessage.classList.remove('hidden');
      setTimeout(() => {
        downloadCompletionMessage.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);

    } catch (err) {
      console.error(err);
      alert('ファイルの作成中にエラーがおきたよ。\n（エラー: ' + err.message + '）');
    }
  });

  // ==========================================
  // アプリケーションのリセット処理
  // ==========================================
  function resetApp() {
    // データ初期化
    currentProjectJsonText = '';
    originalZip = null;
    originalFileName = '';
    originalParsedJson = null;

    // ファイル入力のリセット
    fileInput.value = '';
    fileInfo.innerHTML = '';

    // ラジオボタンの選択解除と自由入力リセット
    templateRadios.forEach(radio => {
      radio.checked = false;
    });
    customQuestion.value = '';
    customQuestionContainer.classList.add('hidden');

    // テキストエリア等のクリア
    modifiedJsonInput.value = '';
    promptOutput.textContent = '';

    // 非表示化
    document.getElementById('step-4').classList.add('hidden');
    completionMessage.classList.add('hidden');
    downloadCompletionMessage.classList.add('hidden');

    // 各ステップのクラスリセット
    setStepState(1, 'active');
    setStepState(2, 'disabled');
    setStepState(3, 'disabled');
    setStepState(4, 'disabled');

    // スムーズスクロールで上に戻す
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // リセットボタンのクリックイベント紐付け
  const resetBtns = document.querySelectorAll('.reset-btn');
  resetBtns.forEach(btn => {
    btn.addEventListener('click', resetApp);
  });
});
