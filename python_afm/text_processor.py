import re
import MeCab
import markovify
import numpy as np
from wordcloud import WordCloud
import matplotlib.pyplot as plt
import psycopg2
from PIL import Image
import os
from datetime import datetime
from create_logs import LogManager

class TextProcessor:
    def __init__(self, db_params):
        self.tagger = MeCab.Tagger()
        self.db_params = db_params
        self.log_manager = LogManager(db_params)
        self.forbidden_words = self._get_forbidden_words()
        # ストップワードのリストを追加
        self.stop_words = self._get_stop_words()
        # 中国語特有の文字リストを追加
        self.chinese_chars = ['读', '难', '书', '说', '谢', '对', '话', '吗', '吧', '们', '这', '你', '她', '很', '给', 'ή', 'ξ', 'ά', 'ί']
        
    def get_texts_from_db(self):
        try:
            with psycopg2.connect(**self.db_params) as conn:
                with conn.cursor() as cur:
                    # テキストの品質フィルタリングを追加
                    cur.execute("""
                        SELECT post_text 
                        FROM public.glt_observation 
                        WHERE post_text IS NOT NULL 
                        AND length(post_text) >= 10
                        AND post_text NOT LIKE '%http%'
                        AND post_text NOT LIKE '%@%'
                        LIMIT 1000
                    """)
                    texts = [row[0] for row in cur.fetchall()]
                    self.log_manager.write_log("INFO", "TextProcessor", "Successfully fetched texts from database")
                    return texts
        except Exception as e:
            self.log_manager.write_log("ERROR", "TextProcessor", f"Database error: {str(e)}")
            return []

    def get_texts_from_db_wordcloud(self):
        try:
            with psycopg2.connect(**self.db_params) as conn:
                with conn.cursor() as cur:
                    # 直近4時間分のデータを取得するようにクエリを修正
                    cur.execute("""
                        SELECT post_text 
                        FROM public.glt_observation 
                        WHERE post_text IS NOT NULL 
                        AND length(post_text) >= 10
                        AND post_text NOT LIKE '%http%'
                        AND post_text NOT LIKE '%@%'
                        AND timestamp >= NOW() - INTERVAL '4 hours'
                        ORDER BY timestamp DESC
                        LIMIT 1000
                    """)
                    texts = [row[0] for row in cur.fetchall()]
                    self.log_manager.write_log("INFO", "TextProcessor", "Successfully fetched texts from database for wordcloud")
                    return texts
        except Exception as e:
            self.log_manager.write_log("ERROR", "TextProcessor", f"Database error: {str(e)}")
            return []

    def _get_forbidden_words(self):
        try:
            with psycopg2.connect(**self.db_params) as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        SELECT value 
                        FROM public.note_text 
                        WHERE key = 'forbidden'
                    """)
                    result = cur.fetchone()
                    if result and result[0]:
                        return result[0]
                    return []
        except Exception as e:
            self.log_manager.write_log("ERROR", "TextProcessor", f"Error fetching forbidden words: {str(e)}")
            return []

    def _get_stop_words(self):
        try:
            with psycopg2.connect(**self.db_params) as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        SELECT value 
                        FROM public.note_text 
                        WHERE key = 'stop_words'
                    """)
                    result = cur.fetchone()
                    if result and result[0]:
                        return result[0]
                    return []
        except Exception as e:
            self.log_manager.write_log("ERROR", "TextProcessor", f"Error fetching stop words: {str(e)}")
            return []

    def _contains_forbidden_words(self, text):
        """禁止ワードが含まれているかチェック"""
        return any(word in text for word in self.forbidden_words)

    def tokenize(self, text):
        if not text or not isinstance(text, str):
            return ""
            
        # 基本的な文字列クリーニング
        text = text.strip()
        text = text.replace('\n', ' ')
        
        node = self.tagger.parseToNode(text)
        words = []
        while node:
            if node.surface not in ['BOS/EOS', '', ' ']:
                # 表層形をそのまま使用
                words.append(node.surface)
            node = node.next
        return ' '.join(words)

    def _contains_only_alphanumeric(self, text):
        """テキストがアルファベットと数字のみで構成されているかチェック"""
        return bool(re.match('^[a-zA-Z0-9]+$', text))

    def _validate_generated_text(self, text):
        """生成されたテキストの品質チェック"""
        if not text:
            return False
        
        # 中国語特有の文字が含まれていないかチェック
        for char in self.chinese_chars:
            if char in text:
                return False
        
        # スペースで分割して各単語をチェック
        words = text.split()
        for word in words:
            if self._contains_only_alphanumeric(word):
                return False
        return True

    def generate_markov_text(self, texts, length=100):
        try:
            if not texts or len(texts) < 10:
                self.log_manager.write_log("WARNING", "TextProcessor", "Insufficient training data")
                raise ValueError("学習データが不足しています")
                
            # テキストの前処理を改善
            processed_texts = []
            for text in texts:
                try:
                    # 中国語特有の文字を含むテキストを除外
                    if any(char in text for char in self.chinese_chars):
                        continue
                        
                    if text and isinstance(text, str) and len(text.strip()) > 10:
                        if not text.strip().endswith('。'):
                            text = text.strip() + '。'
                        processed = self.tokenize(text)
                        if processed and len(processed) >= 10:
                            processed_texts.append(processed)
                except Exception as e:
                    continue

            if len(processed_texts) < 10:
                self.log_manager.write_log("WARNING", "TextProcessor", "Insufficient valid texts after processing")
                raise ValueError("有効なテキストが不足しています")

            combined_text = '\n'.join(processed_texts)
            if not combined_text.strip():
                raise ValueError("テキストの処理後のデータが空です")
            ## state_sizeが3だと元投稿を再現しすぎるため、妥協して2にする。通報歴あり。
            text_model = markovify.NewlineText(
                combined_text,
                state_size=2,
                retain_original=False
            )

            for attempt in range(10):
                try:
                    generated = text_model.make_sentence(
                        tries=100,
                        max_words=50,
                        min_words=5
                    )
                    if generated:
                        result = generated.replace(' ', '')
                        if len(result) >= 10 and self._validate_generated_text(generated):
                            # 禁止ワードチェックを追加
                            if not self._contains_forbidden_words(result):
                                self.log_manager.write_log("INFO", "TextProcessor", "Successfully generated Markov text")
                                return result
                            else:
                                self.log_manager.write_log("WARNING", "TextProcessor", f"Generated text contains forbidden words (attempt {attempt + 1}/10)")
                                continue
                        else:
                            self.log_manager.write_log("WARNING", "TextProcessor", f"Generated text failed validation (attempt {attempt + 1}/10)")
                except Exception as e:
                    self.log_manager.write_log("WARNING", "TextProcessor", f"Generation attempt {attempt + 1} failed: {str(e)}")
                    continue

            # 10回試行しても適切な文章が生成できない場合は最後に生成された文章を返す
            if generated:
                self.log_manager.write_log("WARNING", "TextProcessor", "Returning text with forbidden words after 10 attempts")
                return result.replace(' ', '')
            raise RuntimeError("適切な文章の生成に失敗しました")

        except Exception as e:
            self.log_manager.write_log("ERROR", "TextProcessor", f"Error in generate_markov_text: {str(e)}")
            raise

    def get_wordcloud_forbidden_words(self):
        """ワードクラウドの禁止ワードをデータベースから取得"""
        try:
            with psycopg2.connect(**self.db_params) as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        SELECT value 
                        FROM public.memorandum 
                        WHERE key = 'wordcloud_forbidden'
                    """)
                    result = cur.fetchone()
                    if result and result[0]:
                        # カンマで区切られたテキストを配列に変換
                        return [word.strip() for word in result[0].split(',') if word.strip()]
                    return []
        except Exception as e:
            self.log_manager.write_log("ERROR", "TextProcessor", f"Error fetching wordcloud forbidden words: {str(e)}")
            return []

    def update_wordcloud_forbidden_words(self, words):
        """ワードクラウドの禁止ワードをデータベースに更新"""
        try:
            with psycopg2.connect(**self.db_params) as conn:
                with conn.cursor() as cur:
                    existing_words = self.get_wordcloud_forbidden_words()
                    # 既存のリストの末尾に新しい単語を追加し、重複を除去
                    all_words = existing_words + words
                    unique_words = list(dict.fromkeys(all_words))  # 順序を保持しながら重複を削除
                    
                    # 400単語を超える場合、古い単語（リストの先頭）から削除
                    if len(unique_words) > 400:
                        unique_words = unique_words[-400:]
                    
                    # 配列をカンマ区切りのテキストに変換
                    words_text = ','.join(unique_words)
                    
                    cur.execute("""
                        INSERT INTO public.memorandum (key, value)
                        VALUES ('wordcloud_forbidden', %s)
                        ON CONFLICT (key) DO UPDATE SET value = %s
                    """, (words_text, words_text))
                    conn.commit()
                    
                    self.log_manager.write_log("INFO", "TextProcessor", 
                        f"Updated wordcloud forbidden words: {len(unique_words)} words (max 400)")
                    return True
        except Exception as e:
            self.log_manager.write_log("ERROR", "TextProcessor", 
                f"Error updating wordcloud forbidden words: {str(e)}")
            return False

    def generate_wordcloud(self, texts, output_path):
        try:
            # テキストの前処理を改善
            words = []
            used_words = []  # 実際にワードクラウドで使用された単語を保存
            wordcloud_forbidden = self.get_wordcloud_forbidden_words()
            forbidden_words = self._get_forbidden_words()
            for text in texts:
                node = self.tagger.parseToNode(text)
                while node:
                    features = node.feature.split(',')
                    if (features[0] == '名詞' and
                        features[1] not in ['数', '記号'] and
                        node.surface not in ['', ' ', '　'] and 
                        node.surface not in self.stop_words and
                        node.surface not in wordcloud_forbidden and
                        node.surface not in forbidden_words and
                        len(node.surface) > 1 and
                        not node.surface.isascii() and  # アルファベットのみの単語を除外
                        not any(char in '！？。、．，…‥：；｜＆＊（）［］｛｝「」『』【】＜＞〈〉《》〔〕・＋－＝／＼～①②③④⑤⑥⑦⑧⑨⑩' for char in node.surface)):
                        words.append(node.surface)
                    node = node.next
            
            if not words:
                self.log_manager.write_log("WARNING", "TextProcessor", "No valid words found for wordcloud")
                return False

            processed_text = ' '.join(words)
            
            # フォントの検索順序を変更
            font_paths = [

                '/penetration/fonts/MPLUSRounded1c-Medium.ttf',
                '/usr/share/fonts/truetype/fonts-japanese-gothic.ttf',
                '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
                '/usr/share/fonts/truetype/ipafont-gothic/ipag.ttf',
                '/usr/share/fonts/truetype/vlgothic/VL-Gothic-Regular.ttf',
                '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'  # フォールバック用

            ]
            
            # 利用可能なフォントを探す
            font_path = None
            for path in font_paths:
                if os.path.exists(path):
                    font_path = path
                    break
            
            # フォントが見つからない場合はシステムのデフォルトフォントを使用
            if font_path is None:
                try:
                    import matplotlib.font_manager as fm
                    system_fonts = fm.findSystemFonts()
                    for font in system_fonts:
                        if any(jp_font in font.lower() for jp_font in ['gothic', 'mincho', 'noto', 'ipa']):
                            font_path = font
                            break
                except:
                    font_path = None  # デフォルトのフォントにフォールバック
            
            if not font_path:
                raise FileNotFoundError("Required font files not found")

            # WordCloudの生成
            wordcloud = WordCloud(
                font_path=font_path,
                width=960,
                height=520,
                background_color='white',
                prefer_horizontal=0.7,
                colormap='tab10',
                min_font_size=12,
                max_font_size=80,
                random_state=42,
                regexp=r"[\w']+|[^\s\w]+",
                collocations=False,
                normalize_plurals=False
            ).generate(processed_text)
            
            # 使用された単語と頻度を取得
            word_frequencies = wordcloud.words_
            used_words = list(word_frequencies.keys())
            
            # WordCloudの保存
            wordcloud.to_file(output_path)
            
            # 使用された単語をデータベースに登録
            if used_words:
                update_result = self.update_wordcloud_forbidden_words(used_words)
                self.log_manager.write_log(
                    "INFO",
                    "TextProcessor",
                    f"Updated wordcloud forbidden words with {len(used_words)} words",
                    metadata={"updated_words": used_words}
                )
            
            self.log_manager.write_log(
                "INFO",
                "TextProcessor",
                f"Generated wordcloud at: {output_path}",
                metadata={
                    "font_path": font_path,
                    "word_count": len(used_words),
                    "sample_words": used_words[:5] if used_words else []
                }
            )
            
            return True

        except Exception as e:
            self.log_manager.write_log(
                "ERROR",
                "TextProcessor",
                f"Wordcloud generation error: {str(e)}",
                metadata={"words_found": len(words) if 'words' in locals() else 0}
            )
            return False
