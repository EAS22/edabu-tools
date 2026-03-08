Set objShell = WScript.CreateObject("WScript.Shell")
' Run Node.js server invisibly
objShell.Run "node index.js", 0, False

' Give the server 4 seconds to start before opening the browser
WScript.Sleep 4000

' Open the index.html file in the default browser
objShell.Run "cmd /c start index.html", 0, False
