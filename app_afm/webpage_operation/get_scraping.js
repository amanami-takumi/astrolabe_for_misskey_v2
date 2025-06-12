import WebSocket from 'ws';
import { config } from 'dotenv';
import axios from 'axios';
import { load } from 'cheerio';
import { writeLog } from '../db_operation/create_logs.js';
import { Builder, By, until } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';

config();

// 通常のHTTPリクエストによるスクレイピング
async function getScraping(url, useSelenium = false) {
    // Seleniumを使用する場合
    if (useSelenium) {
        return await getScrapingWithSelenium(url);
    }
    
    // 従来の方法でスクレイピング
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

// 広告やスクリプト関連のテキストをフィルタリングする関数
function filterUnwantedContent(text) {
    if (!text) return '';
    
    // 一般的な広告関連のテキストパターン
    const adPatterns = [
        /googletag\..+/g,
        /window\.sa_event.+/g,
        /window\.[a-zA-Z]+ = window\.[a-zA-Z]+ \|\| .+/g,
        /div-gpt-ad-[0-9]+-[0-9]+/g,
        /#[a-zA-Z]+ {.+}/g,
        /\.[a-zA-Z]+ {.+}/g,  // CSSスタイル
        /function\(\) {.+}/g, // インラインJavaScript関数
        /addService\(googletag\.pubads\(\)\)/g,
        /enableSingleRequest\(\)/g,
        /collapseEmptyDivs\(\)/g,
        /enableServices\(\)/g,
        /display\('[^']+'\)/g
    ];
    
    // 各パターンで不要なテキストを削除
    let filteredText = text;
    adPatterns.forEach(pattern => {
        filteredText = filteredText.replace(pattern, '');
    });
    
    // 連続する空白や改行を単一の空白に置換
    filteredText = filteredText.replace(/\s\s+/g, ' ').trim();
    
    // 短すぎるテキスト行を削除（おそらくメニュー項目やナビゲーション）
    const lines = filteredText.split('\n');
    const filteredLines = lines.filter(line => {
        const trimmedLine = line.trim();
        return trimmedLine.length > 10 || /^[A-Z0-9 ]+$/.test(trimmedLine);
    });
    
    return filteredLines.join('\n').trim();
}

// Seleniumを使用したスクレイピング
async function getScrapingWithSelenium(url) {
    let driver = null;
    try {
        // Chromeの設定
        const options = new chrome.Options();
        options.addArguments('--headless'); // ヘッドレスモード
        options.addArguments('--no-sandbox');
        options.addArguments('--disable-dev-shm-usage');
        options.addArguments('--disable-gpu');
        options.addArguments('--disable-extensions'); // 拡張機能を無効化
        options.addArguments('--disable-popup-blocking'); // ポップアップブロックを無効化
        options.addArguments('--disable-notifications'); // 通知を無効化
        
        // 広告ブロック設定
        options.addArguments('--disable-ads');
        options.addArguments('--disable-features=AutofillServerCommunication');
        
        // WebDriverの作成
        driver = await new Builder()
            .forBrowser('chrome')
            .setChromeOptions(options)
            .build();
        
        // URLに移動
        await driver.get(url);
        
        // ページが読み込まれるまで待機（最大10秒）
        await driver.wait(until.elementLocated(By.tagName('body')), 10000);
        
        // タイトルを取得
        const title = await driver.getTitle();
        
        // 不要な要素を非表示にする
        const unwantedSelectors = [
            'script', 'style', 'iframe', 'noscript', 'header', 'footer', 'nav',
            '[class*="ad"]', '[class*="Ad"]', '[class*="AD"]',
            '[id*="ad"]', '[id*="Ad"]', '[id*="AD"]',
            '[class*="donate"]', '[class*="Donate"]',
            '[class*="banner"]', '[class*="Banner"]',
            '[class*="popup"]', '[class*="Popup"]',
            '[class*="cookie"]', '[class*="Cookie"]',
            '[class*="sidebar"]', '[class*="Sidebar"]',
            '.modal', '#modal', '[class*="modal"]', '[id*="modal"]'
        ];
        
        // JavaScriptを実行して不要な要素を非表示にする
        await driver.executeScript(`
            const unwantedSelectors = ${JSON.stringify(unwantedSelectors)};
            unwantedSelectors.forEach(selector => {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => {
                    el.style.display = 'none';
                });
            });
        `);
        
        // メインコンテンツを取得（優先度順）
        let mainContent = '';
        const contentSelectors = [
            'article', '.article', '#article',
            'main', '.main', '#main',
            'div[role="main"]', '.content-main', '#content-main',
            '.post', '#post', '.post-content', '#post-content',
            '.entry-content', '#entry-content',
            '.main-content', '#main-content',
            '.content', '#content'
        ];
        
        // 各セレクタを試す
        for (const selector of contentSelectors) {
            try {
                const elements = await driver.findElements(By.css(selector));
                if (elements.length > 0) {
                    // 最初に見つかったセレクタのテキストを取得
                    mainContent = await elements[0].getText();
                    break;
                }
            } catch (e) {
                // セレクタが見つからない場合は次へ
                continue;
            }
        }
        
        // セレクタで見つからない場合はbodyタグのテキストを取得
        if (!mainContent) {
            const bodyElement = await driver.findElement(By.tagName('body'));
            mainContent = await bodyElement.getText();
        }
        
        // 不要なコンテンツをフィルタリング
        mainContent = filterUnwantedContent(mainContent);
        
        await writeLog('info', 'getScrapingWithSelenium', `Seleniumによるスクレイピング成功: ${url}`, null, null);
        return { title, mainContent };
        
    } catch (error) {
        const error_message = `Seleniumによるスクレイピング中にエラーが発生: ${error.message}`;
        await writeLog('error', 'getScrapingWithSelenium', error_message, null, null);
        return { title: null, mainContent: null };
    } finally {
        // ドライバーを必ず閉じる
        if (driver) {
            await driver.quit();
        }
    }
}

export { getScraping };