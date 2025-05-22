# deploy_app.py

# === CONFIGURATION ===
admin_url = 't3://localhost:7001'   # Replace with your Admin Server address and port
admin_username = 'weblogic'         # Replace with your admin username
admin_password = 'welcome1'         # Replace with your password

app_name = 'starter-app'            # Name to assign to the deployed app
war_path = '/opt/apps/starter.war' # Full path to the .war file
target_server = 'AdminServer'       # Change this to your target server or cluster name

# === DEPLOYMENT ===
connect(admin_username, admin_password, admin_url)

edit()
startEdit()

# Check if the application is already deployed
if not getMBean('/AppDeployments/' + app_name):
    print('Deploying application:', app_name)
    deploy(app_name, war_path, targets=target_server)
else:
    print('Application already deployed. Redeploying...')
    redeploy(app_name, war_path, targets=target_server)

save()
activate()

disconnect()
exit()
