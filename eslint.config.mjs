import nextVitals from 'eslint-config-next/core-web-vitals'

const eslintConfig = [
  ...nextVitals,
  {
    ignores: [
      'public/**/*.mjs',
      'public/**/*.min.mjs',
    ],
  },
]

export default eslintConfig
