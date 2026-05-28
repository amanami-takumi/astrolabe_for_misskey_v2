import WebSocket from 'ws';
import { config } from 'dotenv';
import axios from 'axios';
import { load } from 'cheerio';
import { writeLog } from '../db_operation/create_logs.js';
import { Builder, By, until } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import fs from 'fs';



config();

function chromeExists() {
    return fs.existsSync('/usr/bin/google-chrome') ||
        fs.existsSync('/usr/bin/google-chrome-stable') ||
        fs.existsSync('/opt/google/chrome/google-chrome');
}

// 通常のHTTPリクエストによるスクレイピング
async function getScraping(url, useSelenium = false) {
    // Seleniumを使用する場合、Chromeが存在するかチェックしてからスクレイピングを試みる
    if (useSelenium) {
        try {
            // Chromeがインストールされているか簡易チェック
            if (!chromeExists()) {
                await writeLog('warn', 'getScraping', 'Google Chromeがインストールされていないため、非Seleniumモードで続行します', null, null);
                // Seleniumを使用せず、通常のHTTPリクエストでスクレイピングを行う
                return getScraping(url, false);
            }
            
            return await getScrapingWithSelenium(url);
        } catch (error) {
            await writeLog('error', 'getScraping', `Seleniumセットアップエラー: ${error.message}。非Seleniumモードで続行します。`, null, null);
            return getScraping(url, false);
        }
    }
    
    // 従来の方法でスクレイピング
    try {
        await writeLog('info', 'getScraping', `HTTPリクエストによるスクレイピングを開始: ${url}`, null, null);
        const response = await axios.get(url, {
            headers: {
                // 一般的なブラウザのユーザーエージェント文字列を設定
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
            }
        });
        const html = response.data;
        await writeLog('info', 'getScraping', `Debug:${html}`, null, null);
        const $ = load(html);

        // ページタイトルを取得
        const title = $('title').text().trim();
        await writeLog('info', 'getScraping', `タイトル取得成功: ${title}`, null, null);

        // スクレイピング前に不要な要素を削除
        removeUnwantedElements($);

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
            '#content',
            '.post-content',
            '.entry-content',
            '.article-content',
            '.story-body'
        ];

        for (const selector of selectors) {
            if ($(selector).length) {
                // 見つかったセレクタ内の不要な要素を再度クリーンアップ
                $(selector).find('script, style, iframe, noscript, .ad, .ads, .advertisement, .banner, [class*="ad-"], [id*="ad-"]').remove();
                mainContent = $(selector).text();
                await writeLog('info', 'getScraping', `セレクタ「${selector}」からコンテンツを抽出しました`, null, null);
                break;
            }
        }

        // 上記のセレクタで見つからない場合、body全体のテキストを取得
        if (!mainContent) {
            // body内の不要な要素を一度削除してからテキスト取得
            $('body').find('header, footer, nav, aside, .sidebar, .widget, .menu, .comments, .comment-section').remove();
            mainContent = $('body').text();
            await writeLog('info', 'getScraping', `bodyからコンテンツを抽出しました: ${mainContent}`, null, null);
        }
        
        // テキストを整形（余分な空白や改行を削除）
        mainContent = cleanupText(mainContent);
        mainContent = mainContent.replace(/▼サーバー運営を助ける支援をお願いします ▼サーバー運営を助ける支援をお願いします 900円 私たちは過去最高の大ヒットを記録しているのと裏腹に価格高騰などの影響でサーバー運営が非常に苦しい状態です。打てる手は全て打ちましたが、それでもまだ危機的状況にあります。なので、GIGAZINEの物理的なサーバーたちを、たった1円でも良いので読者の皆さまに支援してもらえればとっても助かります！今すぐ1回払いの寄付は上のボタンから、毎月寄付はこちらのリンク先から！ ・これまでGIGAZINEを支援してくれたメンバーのリスト/g, '');
        if ((!useSelenium) && shouldRetryWithSelenium(mainContent)) {
            await writeLog('info', 'getScraping', 'プレースホルダー検知のためSeleniumで再取得します', null, null);
            return getScraping(url, true);
        }

        if (mainContent || title) {
            await writeLog('info', 'getScraping', `スクレイピング成功: ${url}、コンテンツ長: ${mainContent ? mainContent.length : 0}文字`, null, null);
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

// HTMLから不要な要素を削除する関数
function removeUnwantedElements($) {
    // 削除する要素のリスト
    const elementsToRemove = [
        'script',
        'style',
        'link',
        'iframe',
        'noscript',
        'svg',
        'form',
        'button',
        'input',
        'select',
        'textarea',
        'header',
        'footer',
        'nav',
        'aside'
    ];
    
    // クラス名やID名のパターン
    const patternsToRemove = [
        '.ad', '.ads', '.ads-banner', '.ad-banner', '.ad-container', '.ad-slot',
        '.advertisement', '.advert', '.sponsor', '.sponsored', '.sponsor-link',
        '.banner-ad', '.promo-banner', '.popup-ad', '.popup-banner', '.cookie-banner',
        '.sidebar-ad', '.ad-widget', '.ad-wrapper', '.adbox', '.adunit',
        '.modal', '#modal', '.modal-overlay', '.popup', '#popup', '.cookie-consent',
        '[class~="ad"]', '[class~="ads"]', '[class^="ad-"]', '[class$="-ad"]',
        '[class*=" ad-"]', '[class*="-ad "]',
        '[id^="ad-"]', '[id$="-ad"]', '#ad', '#ads',
        '[data-ad]', '[data-advertisement]'
    ];

    const preserveRoots = ['#contents-section-1'];
    const shouldPreserve = (element) => {
        const $element = $(element);
        return preserveRoots.some(selector => $element.closest(selector).length > 0);
    };
    
    // 要素を削除
    elementsToRemove.forEach(element => {
        $(element).each((_, el) => {
            if (shouldPreserve(el)) return;
            $(el).remove();
        });
    });
    
    // パターンを削除
    patternsToRemove.forEach(pattern => {
        $(pattern).each((_, el) => {
            if (shouldPreserve(el)) return;
            $(el).remove();
        });
    });

    const phrasesToRemove = [
        '読者の皆さま',
        'ご寄付いただけないでしょうか',
        '支援をお願いします'
    ];

    $('body *').each((_, el) => {
        if (shouldPreserve(el)) return;
        const text = $(el).text();
        if (!text) return;
        if (phrasesToRemove.some(phrase => text.includes(phrase))) {
            $(el).remove();
        }
    });
}

// テキストクリーンアップ関数の強化版
function cleanupText(text) {
    if (!text) return '';
    
    // 連続した空白や改行を単一の空白に置換
    let cleanedText = text.replace(/\s\s+/g, ' ');
    
    // URLや画像リンクなどの不要な情報を削除
    cleanedText = cleanedText.replace(/https?:\/\/[^\s]+/g, '');
    
    // HTMLタグの残りを除去
    cleanedText = cleanedText.replace(/<[^>]*>/g, '');
    
    // 余分な記号や特殊文字のシーケンスを削除
    cleanedText = cleanedText.replace(/\{[^}]*\}/g, ''); // 中括弧内のコンテンツを削除
    cleanedText = cleanedText.replace(/\([^)]*\)/g, ''); // カッコ内の長い内容を削除
    
    // JavaScriptコード片のパターンを削除
    cleanedText = cleanedText.replace(/function\s*\([^)]*\)\s*\{[^}]*\}/g, '');
    cleanedText = cleanedText.replace(/const\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*=/g, '');
    cleanedText = cleanedText.replace(/let\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*=/g, '');
    cleanedText = cleanedText.replace(/var\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*=/g, '');
    cleanedText = cleanedText.replace(/document\.getElementById\([^)]*\)/g, '');
    cleanedText = cleanedText.replace(/window\.[a-zA-Z_$][0-9a-zA-Z_$]*/g, '');
    
    // 複数行に分割して短すぎる行を削除
    const lines = cleanedText.split('\n');
    const cjkPattern = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
    const filteredLines = lines.filter(line => {
        const trimmedLine = line.trim();
        if (!trimmedLine) return false;
        if (cjkPattern.test(trimmedLine)) return true;
        if (trimmedLine.length > 15) return true;
        return /^[A-Z0-9 ]+$/.test(trimmedLine) && trimmedLine.length > 5;
    });
    
    // 再結合して不要な空白を削除
    cleanedText = filteredLines.join('\n').trim();
    
    // 連続した空白をさらに削除
    return cleanedText.replace(/\s\s+/g, ' ').trim();
}

// 広告やスクリプト関連のテキストをフィルタリングする関数
function filterUnwantedContent(text) {
    if (!text) return '';
    
    // クリーンアップされたテキストを取得
    return cleanupText(text);
}

function shouldRetryWithSelenium(mainContent) {
    if (!mainContent) return true;
    const normalized = mainContent.replace(/\s+/g, '');
    const placeholderPatterns = [
        /本文\d{0,2}/,
        /Loading/,
        /JavaScriptが必要/,
        /このコンテンツを表示するには/,
        /しばらくお待ちください/
    ];
    if (placeholderPatterns.some(pattern => pattern.test(normalized))) {
        return true;
    }
    if (normalized.length < 80) {
        return true;
    }
    return false;
}

// Seleniumを使用したスクレイピング
async function getScrapingWithSelenium(url) {
    let driver = null;
    try {
        // Chromeが存在するか確認
        if (!chromeExists()) {
            throw new Error("Chromeがインストールされていません。通常のHTTPリクエストにフォールバックします。");
        }

        await writeLog('info', 'getScrapingWithSelenium', 'Selenium ManagerでChromeDriverを解決します', null, null);
        delete process.env.SELENIUM_CHROME_DRIVER;

        // Chromeオプションを設定
        const options = new chrome.Options();
        options.addArguments('--headless');
        options.addArguments('--no-sandbox');
        options.addArguments('--disable-dev-shm-usage');
        options.addArguments('--disable-gpu');
        options.addArguments('--disable-extensions');
        options.addArguments('--disable-popup-blocking');
        options.addArguments('--disable-notifications');
        options.addArguments('--disable-ads');
        options.addArguments('--disable-features=AutofillServerCommunication');
        
        // Selenium 4.xでのWebDriverビルド方法
        await writeLog('info', 'getScrapingWithSelenium', 'WebDriverを作成します', null, null);
        
        // WebDriverをビルド（Selenium 4.x構文）
        driver = await new Builder()
            .forBrowser('chrome')
            .setChromeOptions(options)
            .build();
        
        await writeLog('info', 'getScrapingWithSelenium', `WebDriver作成成功: ${url}に移動します`, null, null);
        
        // URLに移動
        await driver.get(url);
        
        // ページが読み込まれるまで待機（最大10秒）
        await driver.wait(until.elementLocated(By.tagName('body')), 10000);
        
        // タイトルを取得
        const title = await driver.getTitle();
        
        // 不要な要素を非表示にする
        const unwantedSelectors = [
            'script', 'style', 'iframe', 'noscript', 'header', 'footer', 'nav',
            '.ad', '.ads', '.ads-banner', '.ad-banner', '.ad-container', '.ad-slot',
            '.advertisement', '.advert', '.sponsor', '.sponsored', '.sponsor-link',
            '.banner-ad', '.promo-banner', '.popup-ad', '.popup-banner', '.cookie-banner',
            '.sidebar-ad', '.ad-widget', '.ad-wrapper', '.adbox', '.adunit',
            '.modal', '#modal', '.modal-overlay', '.popup', '#popup', '.cookie-consent',
            '[class~="ad"]', '[class~="ads"]', '[class^="ad-"]', '[class$="-ad"]',
            '[class*=" ad-"]', '[class*="-ad "]',
            '[id^="ad-"]', '[id$="-ad"]', '#ad', '#ads',
            '[data-ad]', '[data-advertisement]'
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
                    
                    await writeLog('info', 'getScrapingWithSelenium', `セレクタ「${selector}」からコンテンツを抽出しました:${mainContent}`, null, null);
                    if (mainContent && mainContent.trim().length > 0) {
                        break;
                    }
                }
            } catch (e) {
                // セレクタが見つからない場合は次へ
                continue;
            }
        }

        // CSSセレクタで取得できない場合は段落単位で広く探索
        if (!mainContent || mainContent.trim().length === 0) {
            try {
                const paragraphs = await driver.executeScript(`
                    const bucket = [];
                    const seen = new Set();
                    const selectors = [
                        'main article p',
                        'main section p',
                        'article section p',
                        'main p',
                        'article p',
                        'section p',
                        'div[role="main"] p',
                        'body p'
                    ];
                    selectors.forEach(selector => {
                        document.querySelectorAll(selector).forEach(el => {
                            const text = (el.innerText || '').trim();
                            if (text.length < 20) return;
                            if (seen.has(text)) return;
                            seen.add(text);
                            bucket.push(text);
                        });
                    });
                    return bucket.slice(0, 60);
                `);
                if (Array.isArray(paragraphs) && paragraphs.length > 0) {
                    mainContent = paragraphs.join('\n').trim();
                    await writeLog('info', 'getScrapingWithSelenium', '段落フォールバックからコンテンツを抽出しました', null, null);
                }
            } catch (fallbackError) {
                await writeLog('warn', 'getScrapingWithSelenium', `段落フォールバック取得に失敗: ${fallbackError.message}`, null, null);
            }
        }
        
        // セレクタで見つからない場合はbodyタグのテキストを取得
        if (!mainContent) {
            const bodyElement = await driver.findElement(By.tagName('body'));
            mainContent = await bodyElement.getText();
            await writeLog('info', 'getScrapingWithSelenium', `bodyからコンテンツを抽出しました:${mainContent}`, null, null);
        }
        
        // 不要なコンテンツをフィルタリング
        mainContent = cleanupText(mainContent);
        
        await writeLog('info', 'getScrapingWithSelenium', `Seleniumによるスクレイピング成功: ${url}, コンテンツ長: ${mainContent ? mainContent.length : 0}文字`, null, null);
        
        return { title, mainContent };
        
    } catch (error) {
        const error_message = `Seleniumによるスクレイピング中にエラーが発生: ${error.message}`;
        await writeLog('error', 'getScrapingWithSelenium', error_message, null, null);
        
        // エラーが発生した場合、通常のHTTPリクエストでのスクレイピングにフォールバック
        await writeLog('info', 'getScrapingWithSelenium', 'HTTPリクエストによるスクレイピングにフォールバックします', null, null);
        
        try {
            // driver が存在する場合は終了
            if (driver) {
                await driver.quit();
                driver = null;
            }
            
            // 非Seleniumモードでスクレイピング
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });
            const html = response.data;
            const $ = load(html);
            
            // スクレイピング前に不要な要素を削除
            removeUnwantedElements($);
            
            const title = $('title').text().trim();
            let mainContent = '';
            
            // メインコンテンツ検索
            const selectors = [
                'article', 'main', 'div[role="main"]', '.main-content',
                '#main-content', '.content', '#content', '.article-content', 
                '.post-content', '.entry-content', 'body'
            ];
            
            for (const selector of selectors) {
                if ($(selector).length) {
                    // 見つかったセレクタ内の不要な要素を再度クリーンアップ
                    $(selector).find('script, style, iframe, noscript').remove();
                    mainContent = $(selector).text();
                    break;
                }
            }
            
            // テキストを整形
            mainContent = cleanupText(mainContent);
            
            return { title, mainContent };
            
        } catch (fallbackError) {
            await writeLog('error', 'getScrapingWithSelenium', `フォールバックスクレイピングも失敗: ${fallbackError.message}`, null, null);
            return { title: null, mainContent: null };
        }
    } finally {
        // ドライバーを必ず閉じる
        if (driver) {
            try {
                await driver.quit();
            } catch (quitError) {
                await writeLog('error', 'getScrapingWithSelenium', `ドライバー終了エラー: ${quitError.message}`, null, null);
            }
        }
    }
}

export { getScraping };
