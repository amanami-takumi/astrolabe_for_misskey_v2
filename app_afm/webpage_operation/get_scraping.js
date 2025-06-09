import WebSocket from 'ws';
import { config } from 'dotenv';
import axios from 'axios';
import { load } from 'cheerio';
import { writeLog } from '../db_operation/create_logs.js';

config();

async function getScraping(url) {
    try {
        const response = await axios.get(url, {
            headers: {
                // 一般的なブラウザのユーザーエージェント文字列を設定
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        const html = response.data;
        const $ = load(html);

        // ページタイトルを取得
        const title = $('title').text().trim();

        // メインコンテンツが含まれていそうなセレクタを試す
        let mainContent = '';

        // 優先度の高いセレクタから順に試す
        const selectors = [
            'article',
            'main',
            'div[role="main"]',
            '.main-content', // 一般的なクラス名
            '#main-content', // 一般的なID
            '.content',
            '#content'
        ];

        for (const selector of selectors) {
            if ($(selector).length) {
                mainContent = $(selector).text();
                break;
            }
        }

        // 上記のセレクタで見つからない場合、body全体のテキストを取得（ただし不要な情報も多く含む可能性あり）
        if (!mainContent) {
            mainContent = $('body').text();
        }
        
        // テキストを整形（余分な空白や改行を削除）
        mainContent = mainContent.replace(/\s\s+/g, ' ').trim();
        // URLや画像リンクなどの不要な情報を削除
        mainContent = mainContent.replace(/https?:\/\/[^\s]+/g, '').replace(/<img[^>]*>/g, '').replace(/<a[^>]*>(.*?)<\/a>/g, '$1');
        
        if (mainContent || title) {
            await writeLog('info', 'getScraping', `スクレイピング成功: ${url}`, null, null);
            return { title, mainContent };
        } else {
            await writeLog('warn', 'getScraping', `タイトルまたはメインコンテンツが見つかりませんでした: ${url}`, null, null);
            return { title: null, mainContent: null };
        }
        
    } catch (error) {
        const error_message = `Webページのスクレイピング中にエラーが発生: ${error.message}`;
        await writeLog('error', 'getScraping', error_message, null, null);
        return { title: null, mainContent: null };
    }
}

export { getScraping };