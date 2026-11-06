import { StyleSheet } from 'react-native'
import { compactCaps, literaryHeading, storyboundColors, storyboundRadii } from '../theme'

export const storeStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: storyboundColors.paper
  },
  content: {
    gap: 14,
    padding: 18,
    paddingBottom: 40
  },
  panel: {
    gap: 12
  },
  heading: {
    ...literaryHeading,
    color: storyboundColors.text,
    fontSize: 26
  },
  copy: {
    color: storyboundColors.text,
    fontSize: 15,
    lineHeight: 22
  },
  rule: {
    color: storyboundColors.text,
    fontSize: 15,
    lineHeight: 22
  },
  hint: {
    color: storyboundColors.muted,
    fontSize: 13
  },
  error: {
    color: storyboundColors.danger,
    fontSize: 14,
    lineHeight: 20
  },
  field: {
    gap: 6
  },
  fieldLabel: {
    ...compactCaps,
    color: storyboundColors.muted
  },
  input: {
    minHeight: 48,
    paddingHorizontal: 13,
    borderColor: storyboundColors.line,
    borderRadius: storyboundRadii.small,
    borderWidth: 1,
    color: storyboundColors.text,
    backgroundColor: storyboundColors.paperRaised,
    fontSize: 16
  },
  check: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11
  },
  checkBox: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: storyboundColors.brass,
    borderRadius: 5,
    borderWidth: 1.5
  },
  checkBoxOn: {
    backgroundColor: storyboundColors.brass
  },
  checkMark: {
    color: storyboundColors.paperRaised,
    fontSize: 15,
    fontWeight: '700'
  },
  checkLabel: {
    flex: 1,
    color: storyboundColors.text,
    fontSize: 15
  },
  chips: {
    flexGrow: 0
  },
  chip: {
    minHeight: 36,
    justifyContent: 'center',
    marginRight: 8,
    paddingHorizontal: 13,
    borderColor: storyboundColors.line,
    borderRadius: 18,
    borderWidth: 1
  },
  chipOn: {
    borderColor: storyboundColors.brass,
    backgroundColor: storyboundColors.brass
  },
  chipLabel: {
    color: storyboundColors.muted,
    fontSize: 13,
    fontWeight: '700'
  },
  chipLabelOn: {
    color: storyboundColors.paperRaised
  },
  sortRow: {
    flexDirection: 'row',
    gap: 18
  },
  sort: {
    color: storyboundColors.muted,
    fontSize: 13,
    fontWeight: '700'
  },
  sortOn: {
    color: storyboundColors.brass
  },
  spinner: {
    marginTop: 40
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 22
  },
  book: {
    width: '47%',
    gap: 3
  },
  bookTitle: {
    marginTop: 8,
    color: storyboundColors.text,
    fontFamily: 'serif',
    fontSize: 15,
    fontWeight: '700'
  },
  pressed: {
    opacity: 0.6
  }
})
