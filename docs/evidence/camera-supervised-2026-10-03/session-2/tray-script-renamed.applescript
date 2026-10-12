tell application "System Events" to tell (first process whose unix id is 28482)
  set mi to menu bar item 1 of menu bar 2
  set ttl to title of mi
  if ttl is not "● CS" then return "REFUSED title=" & ttl
  click mi
  delay 0.4
  set found to (every menu item of menu 1 of mi whose name is "Disconnect")
  if (count of found) is not 1 then
    key code 53
    return "REFUSED no single item Disconnect"
  end if
  set mitem to item 1 of found
  if not (enabled of mitem) then
    key code 53
    return "REFUSED Disconnect disabled"
  end if
  click mitem
  return "clicked Disconnect"
end tell