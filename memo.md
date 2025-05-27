docker compose stop python-afm && docker compose rm -f python-afm && docker compose up -d python-afm


docker exec -i python-afm sh -c "unzip /penetration/M_PLUS_Rounded_1c.zip -d /penetration/fonts/"

docker exec -i python-afm sh -c "ls /usr/share/fonts/truetype/"

chmod -R 777 penetration


git add . && git commit -m "
- WebSocket接続の再接続処理に失敗した場合、手動での再起動を必要としていた問題を修正
※毎日23時に接続処理を再試行する。
" && git push -u origin development

