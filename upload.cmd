setlocal

:: Get current branch name
for /f %%i in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "branch=%%i"
IF "%branch%"=="main" (
  SET subpath=webconfig
) ELSE (
  SET subpath=webconfig-%branch%
)

:: Get the latest commit ID (short hash)
for /f %%i in ('git log -1 --pretty^=format:"%%h" 2^>nul') do set "commit=%%i"

:: Check if we got a commit ID
if not defined commit (
    echo Failed to get commit ID. Are you in a Git repo?
    exit /b 1
)

:: Write to file
echo let commitId="%commit%"; > version.js


aws --profile whazzittoya-content-manager s3 sync  . s3://whazzittoya.com/%subpath% --exclude * --include *.js --include *.css --include *.html --include *.gif --include *.jpg --include *.png --include *.svg --include *.wav --include *.json --exclude package.json --exclude filtrex/* --include  filtrex/src/*.js --delete

aws --profile whazzittoya-content-manager cloudfront create-invalidation --distribution-id E2SZXVA1Z780OI --paths "/*"
