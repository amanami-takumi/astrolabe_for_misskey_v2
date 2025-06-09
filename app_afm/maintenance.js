import { config } from 'dotenv';
import pkg from 'pg';
const { Client } = pkg;
import { updateMultiKVoperation, getMultiKVoperation } from './db_operation/multi_db_connection.js';
import { processadjustmentFollow } from './prosessing_follow.js';
import { writeLog } from './db_operation/create_logs.js';
import { deleteOldLogs } from './db_operation/delete_logs.js';
import { sendDM } from './misskey_operation/create_note.js';
import { clearGLTObservation } from './db_operation/clear_table.js';
config();

// ロガーの設定
const logger = {
    info: (message) => console.log(`INFO: ${message}`),
    error: (message) => console.error(`ERROR: ${message}`)
};


async function resetHeatCounter() {
    try {
        await updateMultiKVoperation('protection', '0', 'heat');
        const info_message = ('heatカウンターを0にリセットしました');
        await writeLog('info', 'resetHeatCounter', info_message, null, null);
        await updateMultiKVoperation('protection', '0', 'chat_gpt_heat');
        const info_message2 = ('chat_gpt_heatカウンターを0にリセットしました');
        await writeLog('info', 'resetHeatCounter', info_message2, null, null);
        await updateMultiKVoperation('protection', '0', 'renote_heat');
        const info_message3 = ('renote_heatカウンターを0にリセットしました');
        await writeLog('info', 'resetHeatCounter', info_message3, null, null);
        await updateMultiKVoperation('protection', '0', 'air_reply_heat');
        const info_message4 = ('air_reply_heatカウンターを0にリセットしました');
        await writeLog('info', 'resetHeatCounter', info_message4, null, null);

    }
    catch (error) {
        const error_message = (`heatカウンターのリセット中にエラーが発生: ${error.message}`);
        await writeLog('error', 'resetHeatCounter', error_message, null, null);
        return false;
    }

}

async function executeMaintenance() {
    let maintenanceResults = [];
    let success = '✅';
    let failure = '❌';

    // heat値カウンターのリセット
    try {
        await resetHeatCounter();
        maintenanceResults.push(`${success} heat値カウンターのリセット`);
    } catch (error) {
        const error_message = `resetHeatCounter実行中にエラーが発生: ${error.message}`;
        await writeLog('error', 'executeMaintenance', error_message, null, null);
        maintenanceResults.push(`${failure} heat値カウンターのリセット`);
    }

    // フォロー調整処理
    try {
        await processadjustmentFollow();
        maintenanceResults.push(`${success} フォロー調整処理`);
    } catch (error) {
        const error_message = `processadjustmentFollow実行中にエラーが発生: ${error.message}`;
        await writeLog('error', 'executeMaintenance', error_message, null, null);
        maintenanceResults.push(`${failure} フォロー調整処理`);
    }

    // 古いログの削除
    try {
        await deleteOldLogs();
        maintenanceResults.push(`${success} 古いログの削除`);
    } catch (error) {
        const error_message = `deleteOldLogs実行中にエラーが発生: ${error.message}`;
        await writeLog('error', 'executeMaintenance', error_message, null, null);
        maintenanceResults.push(`${failure} 古いログの削除`);
    }

    // GTL観測テーブルのクリア
    try {
        await clearGLTObservation();
        maintenanceResults.push(`${success} GTL観測テーブルのクリア`);
    } catch (error) {
        const error_message = `clearGLTObservation実行中にエラーが発生: ${error.message}`;
        await writeLog('error', 'executeMaintenance', error_message, null, null);
        maintenanceResults.push(`${failure} GTL観測テーブルのクリア`);
    }

    const maintenanceMessage = `メンテナンスが完了しました\nメンテナンス結果:\n${maintenanceResults.join('\n')}`;
    await sendDM(maintenanceMessage);
}


// メンテナンス関数のエクスポート
export { executeMaintenance };

// スクリプトが直接実行された場合のみ実行
if (import.meta.url === `file://${process.argv[1]}`) {
    resetHeatCounter().then(success => {
        if (success) {
            process.exit(0);
        } else {
            process.exit(1);
        }
    });
}
