from bisect import bisect_left
from typing import List, Tuple, Optional

import matplotlib
matplotlib.use('Agg')
import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import psycopg2

from create_logs import LogManager
import japanize_matplotlib

#plt.rcParams['font.family'] = '/penetration/fonts/MPLUSRounded1c-Medium.ttf' # 直接フォント名を書いてもOK


class EnvPlot:
    def __init__(self, db_params):
        self.db_params = db_params
        self.log_manager = LogManager(db_params)

    def _fetch_sensor_data(self, column: str) -> List[Tuple]:
        if column not in ('pressure', 'temperature'):
            raise ValueError('Unsupported sensor column: {}'.format(column))

        query = f"""
            SELECT timestamp, {column}
            FROM public.environmental_sensor_logs
            WHERE {column} IS NOT NULL
              AND timestamp >= NOW() - INTERVAL '24 hours'
            ORDER BY timestamp ASC
        """

        try:
            with psycopg2.connect(**self.db_params) as conn:
                with conn.cursor() as cur:
                    cur.execute(query)
                    rows = cur.fetchall()
                    return [(row[0], float(row[1])) for row in rows]
        except Exception as exc:
            self.log_manager.write_log(
                'ERROR',
                'EnvPlot',
                f'Failed to fetch {column} data: {exc}',
                metadata={'column': column}
            )
            return []

    def _render_plot(self, records: List[Tuple], ylabel: str, output_path: str):
        timestamps, values = zip(*records)

        fig, ax = plt.subplots(figsize=(8, 4))
        ax.plot(timestamps, values, color='#2a6ebb', linewidth=2)
        ax.set_xlabel('時間')
        ax.set_ylabel(ylabel)

        min_value = min(values)
        max_value = max(values)
        if min_value == max_value:
            padding = max(1.0, max_value * 0.01)
            ax.set_ylim(min_value - padding, max_value + padding)
        else:
            padding = max((max_value - min_value) * 0.05, 0.5)
            ax.set_ylim(min_value - padding, max_value + padding)

        ax.xaxis.set_major_locator(mdates.AutoDateLocator())
        ax.xaxis.set_major_formatter(mdates.DateFormatter('%m/%d %H:%M'))
        plt.setp(ax.get_xticklabels(), rotation=45, ha='right')

        ax.grid(True, linestyle='--', linewidth=0.5, alpha=0.5)
        fig.tight_layout()
        fig.savefig(output_path, format='png')
        plt.close(fig)

    def create_plot(self, column: str, ylabel: str, output_path: str) -> Optional[int]:
        records = self._fetch_sensor_data(column)
        if not records:
            self.log_manager.write_log(
                'WARNING',
                'EnvPlot',
                f'No {column} data found for last 24 hours'
            )
            return None

        self._render_plot(records, ylabel, output_path)
        self.log_manager.write_log(
            'INFO',
            'EnvPlot',
            f'{column} plot created',
            metadata={'data_points': len(records), 'output_path': output_path}
        )
        return len(records)

    def evaluate_pressure_alert(self) -> Optional[dict]:
        records = self._fetch_sensor_data('pressure')
        if not records:
            self.log_manager.write_log(
                'WARNING',
                'EnvPlot',
                'No pressure data available for alert evaluation'
            )
            return None

        values = [value for _, value in records]
        latest_value = values[-1]
        max_value = max(values)
        min_value = min(values)
        pressure_range = max_value - min_value

        drop_from_max = max_value - latest_value
        if drop_from_max >= 10:
            message = (
                f'最新の気圧が直近24時間の最大値より{drop_from_max:.1f}hPa低下しています'
                f' (最新: {latest_value:.1f}hPa, 最大: {max_value:.1f}hPa)。'
            )
            self.log_manager.write_log(
                'INFO',
                'EnvPlot',
                'Pressure alert triggered by drop from max',
                metadata={'latest': latest_value, 'max': max_value}
            )
            return {'type': 'drop', 'message': message}

        sorted_values = sorted(values)
        position = bisect_left(sorted_values, latest_value)
        worst_threshold_index = min(5, len(sorted_values)) - 1
        if position <= worst_threshold_index:
            rank = position + 1
            threshold_value = sorted_values[worst_threshold_index]
            message = (
                f'最新の気圧が直近24時間のワースト{worst_threshold_index + 1}位以内です'
                f' (順位: {rank}位, 最新: {latest_value:.1f}hPa, ワースト境界: {threshold_value:.1f}hPa)。'
            )
            self.log_manager.write_log(
                'INFO',
                'EnvPlot',
                'Pressure alert triggered by worst ranking',
                metadata={'latest': latest_value, 'rank': rank}
            )
            return {'type': 'worst_rank', 'message': message}

        if pressure_range <= 5:
            message = (
                f'直近24時間の気圧は{pressure_range:.1f}hPa以内で安定しています'
                f' (最大: {max_value:.1f}hPa, 最小: {min_value:.1f}hPa)。'
            )
            self.log_manager.write_log(
                'INFO',
                'EnvPlot',
                'Pressure stable within 5hPa',
                metadata={'max': max_value, 'min': min_value}
            )
            return {'type': 'stable', 'message': message}

        self.log_manager.write_log(
            'INFO',
            'EnvPlot',
            'No pressure alert conditions met',
            metadata={'latest': latest_value, 'range': pressure_range}
        )
        return {'type': 'none'}
