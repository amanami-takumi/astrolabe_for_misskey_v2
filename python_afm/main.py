import os
import tempfile
from dotenv import load_dotenv
from flask import Flask, jsonify, send_file, Response, after_this_request

from text_processor import TextProcessor
from env_plot import EnvPlot
from create_logs import LogManager

app = Flask(__name__)

processor = None
log_manager = None
env_plotter = None


def get_db_params():
    load_dotenv()
    host = os.getenv('POSTGRES_HOST') or 'db-afm'
    return {
        'dbname': os.getenv('POSTGRES_DB'),
        'user': os.getenv('POSTGRES_USER'),
        'password': os.getenv('POSTGRES_PASSWORD'),
        'host': host,
        'port': os.getenv('POSTGRES_PORT')
    }


def init_app():
    global processor, log_manager, env_plotter
    db_params = get_db_params()
    processor = TextProcessor(db_params)
    env_plotter = EnvPlot(db_params)
    log_manager = LogManager(db_params)

    log_manager.write_log(
        'INFO',
        'system',
        'Application initialized',
        metadata={'host': '0.0.0.0', 'port': 3000}
    )


try:
    init_app()
except Exception as exc:
    print(f"Initialization error: {exc}")


@app.route('/generate/pressure_plot', methods=['GET'])
def generate_pressure_plot():
    if env_plotter is None or log_manager is None:
        return jsonify({'error': '初期化エラーが発生しました'}), 500

    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.png')
    temp_file.close()
    temp_path = temp_file.name

    try:
        result = env_plotter.create_plot('pressure', '気圧 (hPa)', temp_path)
        if result is None:
            if os.path.exists(temp_path):
                os.unlink(temp_path)
            return jsonify({'error': '直近24時間の気圧データが見つかりませんでした'}), 404

        log_manager.write_log(
            'INFO',
            'generate_pressure_plot',
            '気圧グラフの生成に成功しました',
            metadata={'temp_file': temp_path}
        )

        @after_this_request
        def cleanup(response):
            if os.path.exists(temp_path):
                os.unlink(temp_path)
            return response

        return send_file(
            temp_path,
            mimetype='image/png',
            as_attachment=True,
            download_name='pressure_plot.png'
        )

    except Exception as exc:
        log_manager.write_log(
            'ERROR',
            'generate_pressure_plot',
            str(exc),
            metadata={'error_type': type(exc).__name__}
        )
        if os.path.exists(temp_path):
            os.unlink(temp_path)
        return jsonify({'error': 'サーバーエラーが発生しました'}), 500


@app.route('/generate/temperature_plot', methods=['GET'])
def generate_temperature_plot():
    if env_plotter is None or log_manager is None:
        return jsonify({'error': '初期化エラーが発生しました'}), 500

    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.png')
    temp_file.close()
    temp_path = temp_file.name

    try:
        result = env_plotter.create_plot('temperature', '気温 (°C)', temp_path)
        if result is None:
            if os.path.exists(temp_path):
                os.unlink(temp_path)
            return jsonify({'error': '直近24時間の気温データが見つかりませんでした'}), 404

        log_manager.write_log(
            'INFO',
            'generate_temperature_plot',
            '気温グラフの生成に成功しました',
            metadata={'temp_file': temp_path}
        )

        @after_this_request
        def cleanup(response):
            if os.path.exists(temp_path):
                os.unlink(temp_path)
            return response

        return send_file(
            temp_path,
            mimetype='image/png',
            as_attachment=True,
            download_name='temperature_plot.png'
        )

    except Exception as exc:
        log_manager.write_log(
            'ERROR',
            'generate_temperature_plot',
            str(exc),
            metadata={'error_type': type(exc).__name__}
        )
        if os.path.exists(temp_path):
            os.unlink(temp_path)
        return jsonify({'error': 'サーバーエラーが発生しました'}), 500


@app.route('/generate/pressure_alert', methods=['GET'])
def generate_pressure_alert():
    if env_plotter is None or log_manager is None:
        return jsonify({'error': '初期化エラーが発生しました'}), 500

    try:
        alert_result = env_plotter.evaluate_pressure_alert()
        if alert_result is None:
            return jsonify({'error': '直近24時間の気圧データが見つかりませんでした'}), 404

        alert_type = alert_result.get('type')
        if alert_type == 'none':
            return ('', 204)

        message = alert_result.get('message', '')
        log_manager.write_log(
            'INFO',
            'generate_pressure_alert',
            '気圧アラート判定を返却しました',
            metadata={'alert_type': alert_type}
        )
        return Response(message, status=200, mimetype='text/plain; charset=utf-8')

    except Exception as exc:
        log_manager.write_log(
            'ERROR',
            'generate_pressure_alert',
            str(exc),
            metadata={'error_type': type(exc).__name__}
        )
        return jsonify({'error': 'サーバーエラーが発生しました'}), 500


@app.route('/generate/text', methods=['GET'])
def generate_text():
    if processor is None or log_manager is None:
        return jsonify({'error': '初期化エラーが発生しました'}), 500

    try:
        texts = processor.get_texts_from_db()
        if not texts:
            log_manager.write_log(
                'WARNING',
                'text_generator',
                'No texts found in database'
            )
            return jsonify({'error': 'データベースにテキストが見つかりませんでした'}), 404

        try:
            generated_text = processor.generate_markov_text(texts)
            
            log_manager.write_log(
                'INFO',
                'text_generator',
                'テキストの生成に成功しました',
                metadata={'text_length': len(generated_text)}
            )

            return jsonify({'text': generated_text})

        except ValueError as ve:
            log_manager.write_log(
                'WARNING',
                'text_generator',
                str(ve),
                metadata={'error_type': 'ValueError'}
            )
            return jsonify({'error': str(ve)}), 400

        except RuntimeError as re:
            log_manager.write_log(
                'ERROR',
                'text_generator',
                str(re),
                metadata={'error_type': 'RuntimeError'}
            )
            return jsonify({'error': str(re)}), 500

    except Exception as e:
        log_manager.write_log(
            'ERROR',
            'text_generator',
            str(e),
            metadata={'error_type': type(e).__name__}
        )
        return jsonify({'error': 'サーバーエラーが発生しました'}), 500


@app.route('/generate/wordcloud', methods=['GET'])
def generate_wordcloud():
    if processor is None or log_manager is None:
        return jsonify({'error': '初期化エラーが発生しました'}), 500

    temp_path = None
    try:
        texts_wordcloud = processor.get_texts_from_db_wordcloud()
        if not texts_wordcloud:
            log_manager.write_log(
                'WARNING',
                'generate_wordcloud',
                'No texts_wordcloud found in database'
            )
            return jsonify({'error': 'テキストが見つかりませんでした'}), 404

        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.png')
        temp_path = temp_file.name
        temp_file.close()
        
        wordcloud = processor.generate_wordcloud(texts_wordcloud, temp_path)
        if wordcloud is None:
            return jsonify({'error': 'ワードクラウドの生成に失敗しました'}), 500

        log_manager.write_log(
            'INFO',
            'generate_wordcloud',
            'ワードクラウドの生成に成功しました',
            metadata={
                'temp_file': temp_path
            }
        )

        @after_this_request
        def cleanup(response):
            if temp_path and os.path.exists(temp_path):
                os.unlink(temp_path)
            return response

        return send_file(
            temp_path,
            mimetype='image/png',
            as_attachment=True,
            download_name='wordcloud.png'
        )

    except Exception as e:
        log_manager.write_log(
            'ERROR',
            'generate_wordcloud',
            str(e),
            metadata={'error_type': type(e).__name__}
        )
        if temp_path and os.path.exists(temp_path):
            os.unlink(temp_path)
        return jsonify({'error': 'サーバーエラーが発生しました'}), 500


if __name__ == "__main__":
    if log_manager:
        log_manager.write_log(
            'INFO',
            'system',
            'Flask application started',
            metadata={'host': '0.0.0.0', 'port': 3000}
        )
    app.run(host='0.0.0.0', port=3000)
