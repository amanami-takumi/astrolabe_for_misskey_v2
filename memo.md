docker compose stop python-afm && docker compose rm -f python-afm && docker compose up -d python-afm


docker exec -i python-afm sh -c "unzip /penetration/M_PLUS_Rounded_1c.zip -d /penetration/fonts/"

docker exec -i python-afm sh -c "ls /usr/share/fonts/truetype/"

chmod -R 777 penetration


git add . && git commit -m "
誤って環境移行用のバックアップファイルがアップロードされてしまったため、それを削除
" && git push -u origin development

