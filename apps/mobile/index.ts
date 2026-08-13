import { registerRootComponent } from 'expo'
import 'react-native-url-polyfill/auto'

import App from './App'
import { installRuntimePolyfills } from './src/polyfills'

installRuntimePolyfills()

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App)
