import 'react-native-url-polyfill/auto'
import { AppRegistry } from 'react-native'
import App from './App'
import { name as appName } from './app.json'
import { registerBackgroundHandler } from './src/hooks/usePushNotifications'

// Must be called before AppRegistry
// Handles push notifications when app is in background or quit
registerBackgroundHandler()

AppRegistry.registerComponent(appName, () => App)
