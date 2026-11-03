import { StyleSheet } from 'react-native'
import { storyboundColors, storyboundRadii } from '../theme'

/** Shared look for the bottom sheets' titles, fields, and buttons. */
export const sheetStyles = StyleSheet.create({
  title: {
    color: storyboundColors.text,
    fontFamily: 'serif',
    fontSize: 21,
    fontWeight: '700'
  },
  message: {
    color: storyboundColors.muted,
    fontSize: 14,
    lineHeight: 20
  },
  input: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: storyboundColors.line,
    borderRadius: storyboundRadii.small,
    color: storyboundColors.text,
    backgroundColor: storyboundColors.paper,
    fontSize: 16
  },
  error: {
    color: storyboundColors.danger,
    fontSize: 13
  },
  actions: {
    flexDirection: 'row',
    gap: 12
  },
  action: {
    flex: 1
  }
})
