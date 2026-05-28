import { write } from 'fs';
import Parser from 'rss-parser';

const parser = new Parser();

/**
 * トラフィックニュースのフィードを取得する
 * @returns {Promise<Array>} フィードアイテムの配列
 */
export async function getTrafficNewsFeed() {
    try {
        const feed = await parser.parseURL('https://trafficnews.jp/feed');
        return feed.items;
    } catch (error) {
        console.error('フィードの取得に失敗しました:', error);
        return [];
    }
}

export async function getGigazinFeed() {
    try {
        const feed = await parser.parseURL('https://gigazine.net/news/rss_2.0/');
        return feed.items;
    } catch (error) {
        console.error('フィードの取得に失敗しました:', error);
        return [];
    }
}


export async function getNazologyFeed() {
    try {
        const feed = await parser.parseURL('https://nazology.kusuguru.co.jp/feed');
        return feed.items;
    } catch (error) {
        console.error('フィードの取得に失敗しました:', error);
        return [];
    }
}

export async function getPublickeyFeed() {
    try {
        const feed = await parser.parseURL('https://www.publickey1.jp/atom.xml');
        return feed.items;
    } catch (error) {
        console.error('フィードの取得に失敗しました:', error);
        return [];
    }
}

export async function getGameSparkFeed() {
    try {
        const feed = await parser.parseURL('https://www.gamespark.jp/rss20/index.rdf');
        return feed.items;
    } catch (error) {
        console.error('フィードの取得に失敗しました:', error);
        return [];
    }
}

export async function getMultiFeed_v2(url) {
    //console.log('getMultiFeed_v2 called with URL:', url);
    const items = await getMultiFeedFunc(url);
    
    return items;
}



export async function getMultiFeedFunc(parseURL) {
    try {
        const feed = await parser.parseURL(parseURL);
        return feed.items;
    } catch (error) {
        console.error('フィードの取得に失敗しました:', error);
        return [];
    }
}

export async function getMultiFeed(parseURL, count = 1) {
    const items = await getMultiFeedFunc(parseURL);
    return items.slice(0, count);
}

/**
 * 最新のフィード記事を取得する
 * @param {number} count 取得する記事数
 * @returns {Promise<Array>} 最新の記事の配列
 */
export async function getTrafficNews(count = 1) {
    const Trafficitems = await getTrafficNewsFeed();
    return Trafficitems.slice(0, count);
}

export async function getGigazin(count = 1) {
    const Triviaitems = await getGigazinFeed();
    return Triviaitems.slice(0, count);
}

export async function getNazology(count = 1) {
    const Triviaitems = await getNazologyFeed();
    return Triviaitems.slice(0, count);
}
export async function getPublickey(count = 1) {
    const Triviaitems = await getPublickeyFeed();
    return Triviaitems.slice(0, count);
}
export async function getGameSpark(count = 1) {
    const Triviaitems = await getGameSparkFeed();
    return Triviaitems.slice(0, count);
}