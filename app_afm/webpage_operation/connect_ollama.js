import { config } from 'dotenv';
import OpenAI from 'openai';
import { writeLog } from '../db_operation/create_logs.js';
import axios from 'axios';
import { sendDM, createNote, createNoteWithMedia } from '../misskey_operation/create_note.js';



config();

// OLLAMA APIのURLを環境変数から取得するか、デフォルト値を設定
const OLLAMA_API_URL = process.env.OLLAMA_API_URL || '192.168.0.176:11434';





async function air_reply_ollama(input_text) {
    try {

        // 0-5分のランダムな待機時間を設定
        await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 6) * 60 * 1000));
        // システムプロンプトの作成
        const system_prompt = `
あなたはSNS上で人間らしく振る舞うための小規模言語モデルです。以下の条件に従って、投稿に対する「エアリプ」を出力してください。

- 入力される投稿は引用符（「」）で囲まれた文章です。
- その投稿に対する、間接的・非明示的な反応を1文で出力してください。
- 投稿の内容を明示的に引用したり、話題に直接触れたりしないでください。
- 投稿から類推される経験・事例・感想・違和感・疑問などを、間接的に言及してください。
- 出力は50字以内に収めてください。
- 丁寧語は禁止です（例：「です」「ます」などは使わない）。
- 出力は1文のみで、余計な装飾や文頭の記号などはつけないこと。
`;


        
        // OllamaのAPI仕様に合わせたリクエストボディを作成
        const requestBody = {
            model: "phi4",
            messages: [
                {
                    role: "system",
                    content: system_prompt
                },
                {
                    role: "user",
                    content: `「${input_text}」`
                }
            ],
            stream: false
        };

        // OLLAMA_API_URLへの疎通確認
        const accessURL = `http://${OLLAMA_API_URL}/api/chat`;
        try {
            await axios.post(accessURL);
            console.log(`Ollama APIへの疎通確認に成功: ${accessURL}`);
        } catch (connErr) {
            console.error(`Ollama APIへの疎通確認に失敗: ${accessURL} - ${connErr.message}`);
            //throw new Error('Ollama APIへの接続に失敗しました');
        }        

        // API呼び出し開始時間
        const startTime = performance.now();

        // Ollamaサーバーに対してPOSTリクエストを送信
        const response = await axios.post(accessURL, requestBody);

        // API呼び出し終了時間
        const endTime = performance.now();
        const duration = endTime - startTime; // 処理時間（ミリ秒）

        // レスポンスからテキストを取得
        if (response.data && response.data.message && response.data.message.content) {
            const message = response.data.message.content.trim();
            await createNote(message);
            
            const info_message = `Ollama生成テキストの投稿を実行 (処理時間: ${duration.toFixed(2)}ms)`;
            await writeLog('info', 'ollama_connect', info_message, null, null);
        } else {
            throw new Error('有効なレスポンスデータが見つかりません');
        }
    }
    catch (error) {
        const error_message = `Ollama接続エラー: ${error.message}`;
        await writeLog('error', 'ollama_connect', error_message, null, null);
        console.error(error_message);
    }
}



async function summary_ollama(input_text) {
    try {

        // システムプロンプトの作成
        const system_prompt = `
あなたは人間らしく振る舞うための小規模言語モデルです。以下の条件に従って、記事を要約してください。

- 出力は50字以内に収めてください。
- 丁寧語は禁止です（例：「です」「ます」などは使わない）。
- 出力は1文のみで、余計な装飾や文頭の記号などはつけないこと。
`;


        
        // OllamaのAPI仕様に合わせたリクエストボディを作成
        const requestBody = {
            model: "hf.co/SakanaAI/TinySwallow-1.5B-Instruct-GGUF:latest",
            messages: [
                {
                    role: "system",
                    content: system_prompt
                },
                {
                    role: "user",
                    content: `「${input_text}」`
                }
            ],
            stream: false
        };

        //console.log(requestBody); // リクエストボディの内容をログに出力

        // OLLAMA_API_URLへの疎通確認
        const accessURL = `http://${OLLAMA_API_URL}/api/chat`;
        try {
            await axios.post(accessURL);
            console.log(`Ollama APIへの疎通確認に成功: ${accessURL}`);
        } catch (connErr) {
            console.error(`Ollama APIへの疎通確認に失敗: ${accessURL} - ${connErr.message}`);
            //throw new Error('Ollama APIへの接続に失敗しました');
        }        
    
        // API呼び出し開始時間
        const startTime = performance.now();

        // Ollamaサーバーに対してPOSTリクエストを送信
        const response = await axios.post(accessURL, requestBody);

        // API呼び出し終了時間
        const endTime = performance.now();
        const duration = endTime - startTime; // 処理時間（ミリ秒）

        console.log(`Ollama APIへのリクエスト: ${accessURL}`); // リクエストURLをログに出力
        console.log(response);
        // レスポンスからテキストを取得
        if (response.data && response.data.message && response.data.message.content) {
            const message = response.data.message.content.trim();
            // await createNote(message); // Misskeyへの投稿を削除
            
            const info_message = `Ollama要約生成を実行 (処理時間: ${duration.toFixed(2)}ms)`; // ログメッセージを修正
            await writeLog('info', 'summary_ollama', info_message, null, null); // 関数名をログに正しく反映
            return message; // 要約テキストを返す
        } else {
            throw new Error('有効なレスポンスデータが見つかりません');
        }
    }
    catch (error) {
        const error_message = `Ollama接続エラー (summary_ollama): ${error.message}`; // エラーメッセージにコンテキスト追加
        await writeLog('error', 'summary_ollama', error_message, null, null); // 関数名をログに正しく反映
        console.error(error_message);
        return null; // エラー時はnullを返すなど、エラー処理を明確に
    }
}

export {
    air_reply_ollama,
    summary_ollama
};