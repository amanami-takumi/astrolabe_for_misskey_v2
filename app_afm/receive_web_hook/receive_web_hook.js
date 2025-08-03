import express from 'express';
import { writeLog } from '../db_operation/create_logs.js';
import {insertSensorLog, insertEarthquakeLog , retrieveSensorLogs } from   '../db_operation/multi_sensor_connection.js';
import { createNote } from '../misskey_operation/create_note.js';
import { updateMultiKVoperation, getMultiKVoperation } from '../db_operation/multi_db_connection.js';

// ウェブフックデータの処理関数
export async function processWebhookData(data, headers, endpoint) {
    try {
        console.log('ウェブフックデータを受信:', { endpoint, data, headers });
        
        // リクエストの詳細をログに記録
        await writeLog('info', 'webhook_received', `ウェブフック受信: ${endpoint}`, JSON.stringify({ data, headers }), null);
        
        // エンドポイントに応じた処理の分岐
        switch (endpoint) {
            case '/webhook/earthquake':
                await handleEarthquakeNotification(data);
                break;
            case '/webhook/temperature':
                await handleTemperatureData(data);
                break;
            case '/webhook/pressure':
                await handlePressureData(data);
                break;
            case '/webhook/scheduled':
                await handleScheduledData(data);
                break;
            case '/webhook/monitoring':
                await handleMonitoringData(data);
                break;
            default:
                await writeLog('warn', 'webhook_unknown', `未知のエンドポイント: ${endpoint}`, JSON.stringify(data), null);
        }
        
        return { success: true, message: 'データを正常に処理しました' };
    } catch (error) {
        const errorMessage = `ウェブフック処理エラー (${endpoint}): ${error.message}`;
        console.error(errorMessage, error);
        await writeLog('error', 'webhook_error', errorMessage, JSON.stringify(data), error.stack);
        throw error;
    }
}

// 地震発生時の緊急通知処理
async function handleEarthquakeNotification(data) {
    try {
        const { sensor_id, measure_scale, JMA_scale, resultant_gal, gal_x, gal_y, gal_z } = data;

        if (!gal_x || !gal_y || !gal_z) {
            throw new Error('地震データに必要な情報が不足しています');
        }
        // DBへの記録
        await insertEarthquakeLog({ sensor_id, measure_scale, resultant_gal, gal_x, gal_y, gal_z });

        // 投稿の前処理（Heat値チェック）
        const max_earthquake_heat = await getMultiKVoperation('settings', 'max_earthquake_heat');
        const now_earthquake_heat = await getMultiKVoperation('protection', 'earthquake_heat');
        if (Number(now_earthquake_heat) > Number(max_earthquake_heat)) {
            return;
        }
        // Heat値の更新
        let updated_earthquake_heat = Number(now_earthquake_heat) + 1;
        await updateMultiKVoperation('protection', updated_earthquake_heat, 'earthquake_heat');

        // 投稿間隔チェック (10分)
        const last_post_time_str = await getMultiKVoperation('memorandum', 'last_earthquake_post_time');
        if (last_post_time_str) {
            const last_post_time = new Date(last_post_time_str);
            const now = new Date();
            const diff_minutes = (now - last_post_time) / (1000 * 60);
            if (diff_minutes < 10) {
                await writeLog('info', 'earthquake_notification_skipped', '投稿間隔が10分未満のためスキップしました', null, null);
                return;
            }
        }

        // 緊急度に応じたメッセージの作成
        let message = '';
        let isUrgent = false;

        if (measure_scale >= 4.0) {
            isUrgent = true;
            message = `ゆれ\n`;
            message += `これは震度${JMA_scale}くらいでしょうか`;
            const result = await createNote(message);
            await writeLog('info', 'earthquake_notification', 'Misskeyに投稿しました', result, null);
            // 最終投稿時間を更新
            await updateMultiKVoperation('memorandum', new Date().toISOString(), 'last_earthquake_post_time');
        } else {
            message = `📊 地震観測データ\n\n`;
        }

    } catch (error) {
        const errorMessage = `地震通知処理エラー: ${error.message}`;
        console.error(errorMessage, error);
        await writeLog('error', 'earthquake_notification', errorMessage, JSON.stringify(data), error.stack);
        throw error;
    }
}

// 温度データの処理
async function handleTemperatureData(data) {
    try {
        const { temperature } = data;
        
        if (temperature === undefined) {
            throw new Error('温度データが含まれていません');
        }
        
        let message = '';
        let shouldPost = false;
        
        // アラート条件の確認
        if (temperature > 42 || temperature < 10) {
            shouldPost = true;
            if (temperature > 42) {
                message = `あっっっつ！\n\n`;
            } else {
                message = `さっっっむ！\n\n`;
            }
            message += `今見たら室温が ${temperature}°Cになってます！\n`;


        } else {
            console.log('温度データを記録（投稿なし）:', { temperature });
        }
        
        if (shouldPost) {
            const result = await createNote(message);
            await writeLog('info', 'temperature_data', '温度データを投稿', JSON.stringify(data), null);
        } else {
            await writeLog('info', 'temperature_data', '温度データを記録（投稿なし）', JSON.stringify(data), null);
        }

        console.log('温度データを処理しました:', { temperature, shouldPost });
        
    } catch (error) {
        const errorMessage = `温度データ処理エラー: ${error.message}`;
        console.error(errorMessage, error);
        await writeLog('error', 'temperature_data', errorMessage, JSON.stringify(data), error.stack);
        throw error;
    }
}

// 気圧データの処理
async function handlePressureData(data) {
    try {
        const { pressure } = data;
        
        if (pressure === undefined) {
            throw new Error('気圧データが含まれていません');
        }
        
        let message = '';
        let shouldPost = false;
        
        // アラート条件の確認（急激な気圧変化など）
        if (alert || pressure < 990 || pressure > 1030) {
            shouldPost = true;
            if (pressure < 990) {
                message = `ん゛゛ん\n\nなんか頭痛いかも。天気が悪くなるかもです。気圧は ${pressure}hPaくらいかも。\n`;
            } else if (pressure > 1030) {
                message = `天気が良くなるかもです。気圧は ${pressure}hPaくらいかも。\n`;
            }
        } else {
            console.log('気圧データを記録（投稿なし）:', { pressure });
        }
        
        if (shouldPost) {
            const result = await createNote(message);
            await writeLog('info', 'pressure_data', '気圧データを投稿', JSON.stringify(data), null);
        } else {
            await writeLog('info', 'pressure_data', '気圧データを記録（投稿なし）', JSON.stringify(data), null);
        }
        
        console.log('気圧データを処理しました:', { pressure, trend, shouldPost });
        
    } catch (error) {
        const errorMessage = `気圧データ処理エラー: ${error.message}`;
        console.error(errorMessage, error);
        await writeLog('error', 'pressure_data', errorMessage, JSON.stringify(data), error.stack);
        throw error;
    }
}

// 定時データの処理
async function handleScheduledData(data) {
    try {
        const { sensor_id, temperature, pressure } = data;

        // DBへの記録
        await insertSensorLog({ sensor_id, temperature, pressure });

        // 投稿の前処理（Heat値チェック）
        const max_environmental_heat = await getMultiKVoperation('settings', 'max_environmental_heat');
        const now_environmental_heat = await getMultiKVoperation('protection', 'environmental_heat');
        if (Number(now_environmental_heat) > Number(max_environmental_heat)) {
            return;
        }
        // Heat値の更新
        let updated_environmental_heat = Number(now_environmental_heat) + 1;
        await updateMultiKVoperation('protection', updated_environmental_heat, 'environmental_heat');


        // 投稿処理
        if (temperature >= 40) {
            const message = `あっつ！\n今見たら気温が ${temperature}°Cになってます！\n`;
            const result = await createNote(message);    
            await writeLog('info', 'temperature_data', '温度データを投稿', null, result);
            

        } else if (temperature <= 10) {
            const message = `さっむ！\n今見たら気温が ${temperature}°Cになってます！\n`;
            const result = await createNote(message);
            await writeLog('info', 'temperature_data', '温度データを投稿', null, result);
        } else if (pressure < 990 || pressure > 1030) {
            const message = `なんだか頭が痛くなってしまいそうな気圧です。現在の気圧は、、えっと ${pressure}hPaです。`;
            const result = await createNote(message);
            await writeLog('info', 'pressure_data', '気圧データを投稿', null, result);
        }

    } catch (error) {
        const errorMessage = `定時データ処理エラー: ${error.message}`;
        console.error(errorMessage, error);
        await writeLog('error', 'scheduled_data', errorMessage, null, error.stack);
        throw error;
    }
}

async function handleMonitoringData(data) {
    try {
        const { sensor_id, temperature, pressure } = data;

        await writeLog('info', 'monitoring_data', '死活データを記録', null, JSON.stringify(data));

    } catch (error) {
        const errorMessage = `定時データ処理エラー: ${error.message}`;
        console.error(errorMessage, error);
        await writeLog('error', 'scheduled_data', errorMessage, null,  error.stack);
        throw error;
    }
}

// ウェブフックルートの設定
export function setupWebhookRoutes(app) {
    // JSONボディパーサーを有効にする
    app.use('/webhook', express.json({ limit: '10mb' }));
    app.use('/webhook', express.urlencoded({ extended: true, limit: '10mb' }));
    
    // 地震計測センサからの通知
    app.post('/webhook/earthquake', async (req, res) => {
        try {
            await processWebhookData(req.body, req.headers, '/webhook/earthquake');
            res.status(200).json({ success: true, message: '地震データを正常に処理しました' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });
    
    // 温度計測センサからの通知
    app.post('/webhook/temperature', async (req, res) => {
        try {
            await processWebhookData(req.body, req.headers, '/webhook/temperature');
            res.status(200).json({ success: true, message: '温度データを正常に処理しました' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });
    
    // 気圧計測センサからの通知
    app.post('/webhook/pressure', async (req, res) => {
        try {
            await processWebhookData(req.body, req.headers, '/webhook/pressure');
            res.status(200).json({ success: true, message: '気圧データを正常に処理しました' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });
    
    // 定時データ取得
    app.post('/webhook/scheduled', async (req, res) => {
        try {
            await processWebhookData(req.body, req.headers, '/webhook/scheduled');
            res.status(200).json({ success: true, message: '定時データを正常に処理しました' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });
    
    // 汎用ウェブフックエンドポイント
    app.post('/webhook/general', async (req, res) => {
        try {
            await processWebhookData(req.body, req.headers, '/webhook/general');
            res.status(200).json({ success: true, message: 'データを正常に処理しました' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });
    
    // 死活監視エンドポイント
    app.post('/webhook/monitoring', async (req, res) => {
        try {
            await processWebhookData(req.body, req.headers, '/webhook/monitoring');
            res.status(200).json({ success: true, message: '死活データを正常に処理しました' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });
    
    // ヘルスチェック用エンドポイント
    app.get('/webhook/health', (req, res) => {
        res.status(200).json({ 
            status: 'healthy', 
            timestamp: new Date().toISOString(),
            endpoints: [
                '/webhook/earthquake',
                '/webhook/temperature', 
                '/webhook/pressure',
                '/webhook/scheduled',
                '/webhook/monitoring',
                '/webhook/general'
            ]
        });
    });
    
    // ルートエンドポイント - ウェブフックヘルプの表示
    app.get('/', (req, res) => {
        const acceptHeader = req.headers.accept || '';
        const isHtmlRequest = acceptHeader.includes('text/html');
        
        const endpoints = [
            {
                path: '/webhook/earthquake',
                method: 'POST',
                description: '地震データの通知を受信',
                parameters: ['sensor_id', 'measure_scale', 'JMA_scale', 'resultant_gal', 'gal_x', 'gal_y', 'gal_z']
            },
            {
                path: '/webhook/temperature',
                method: 'POST',
                description: '温度データの通知を受信',
                parameters: ['temperature']
            },
            {
                path: '/webhook/pressure',
                method: 'POST',
                description: '気圧データの通知を受信',
                parameters: ['pressure']
            },
            {
                path: '/webhook/scheduled',
                method: 'POST',
                description: '定時データの受信',
                parameters: ['sensor_id', 'temperature', 'pressure']
            },
            {
                path: '/webhook/monitoring',
                method: 'POST',
                description: '死活監視データの受信',
                parameters: ['sensor_id', 'temperature', 'pressure']
            },
            {
                path: '/webhook/general',
                method: 'POST',
                description: '汎用ウェブフックデータの受信',
                parameters: ['任意のデータ']
            },
            {
                path: '/webhook/health',
                method: 'GET',
                description: 'ヘルスチェック',
                parameters: []
            }
        ];
        
        if (isHtmlRequest) {
            // ブラウザからのアクセス時はHTMLを返す
            const html = `
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Webhook API ヘルプ</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; background-color: #f5f5f5; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #333; border-bottom: 2px solid #007acc; padding-bottom: 10px; }
        h2 { color: #555; margin-top: 30px; }
        .endpoint { background: #f8f9fa; padding: 15px; margin: 10px 0; border-radius: 5px; border-left: 4px solid #007acc; }
        .method { font-weight: bold; color: #007acc; }
        .path { font-family: monospace; background: #e9ecef; padding: 2px 6px; border-radius: 3px; }
        .params { margin-top: 10px; }
        .param { display: inline-block; background: #e7f3ff; padding: 2px 6px; margin: 2px; border-radius: 3px; font-size: 0.9em; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; text-align: center; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔗 Webhook API ヘルプ</h1>
        <p>このサーバーは各種センサーデータやイベントの通知を受信するWebhook APIを提供しています。</p>
        
        <h2>📋 利用可能なエンドポイント</h2>
        ${endpoints.map(endpoint => `
        <div class="endpoint">
            <div>
                <span class="method">${endpoint.method}</span>
                <span class="path">${endpoint.path}</span>
            </div>
            <div style="margin-top: 5px; color: #666;">${endpoint.description}</div>
            ${endpoint.parameters.length > 0 ? `
            <div class="params">
                <strong>パラメータ:</strong>
                ${endpoint.parameters.map(param => `<span class="param">${param}</span>`).join('')}
            </div>
            ` : ''}
        </div>
        `).join('')}
        
        <h2>📝 使用例</h2>
        <div class="endpoint">
            <strong>温度データの送信例:</strong>
            <pre style="background: #f8f9fa; padding: 10px; margin-top: 10px; overflow-x: auto;">
curl -X POST http://localhost:5000/webhook/temperature \\
  -H "Content-Type: application/json" \\
  -d '{
    "temperature": 25.5,
    "timestamp": "2025-07-02T12:00:00Z",
    "alert": false
  }'</pre>
        </div>
        
        <div class="footer">
            <p>最終更新: ${new Date().toISOString()}</p>
            <p>サーバー稼働中 🟢</p>
        </div>
    </div>
</body>
</html>`;
            res.send(html);
        } else {
            // API呼び出し時はJSONを返す
            res.json({
                title: 'Webhook API ヘルプ',
                description: 'このサーバーは各種センサーデータやイベントの通知を受信するWebhook APIを提供しています。',
                server_status: 'running',
                timestamp: new Date().toISOString(),
                endpoints: endpoints
            });
        }
    });
    
    console.log('ウェブフックルートが設定されました');
}
