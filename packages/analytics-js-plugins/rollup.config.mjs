/* eslint-disable import/no-extraneous-dependencies */
import path from 'path';
import babel from '@rollup/plugin-babel';
import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import terser from '@rollup/plugin-terser';
import json from '@rollup/plugin-json';
import { visualizer } from 'rollup-plugin-visualizer';
import filesize from 'rollup-plugin-filesize';
import livereload from 'rollup-plugin-livereload';
import serve from 'rollup-plugin-serve';
import typescript from 'rollup-plugin-typescript2';
import nodePolyfills from 'rollup-plugin-polyfill-node';
import { DEFAULT_EXTENSIONS } from '@babel/core';
import del from 'rollup-plugin-delete';
import dts from 'rollup-plugin-dts';
import alias from '@rollup/plugin-alias';
import federation from '@originjs/vite-plugin-federation';
import * as dotenv from 'dotenv';
import pkg from './package.json' assert { type: 'json' };
import copy from "rollup-plugin-copy";

dotenv.config();
const isLegacyBuild = process.env.BROWSERSLIST_ENV !== 'modern';
const variantSubfolder = isLegacyBuild ? '/legacy' : '/modern';
const sourceMapType =
  process.env.PROD_DEBUG === 'inline' ? 'inline' : process.env.PROD_DEBUG === 'true';
const outDirNpmRoot = `dist/npm`;
const outDirCDNRoot = `dist/cdn`;
const outDirNpm = `${outDirNpmRoot}${variantSubfolder}`;
const outDirCDN = `${outDirCDNRoot}${variantSubfolder}/plugins`;
const distName = 'rsa-plugins';
const modName = 'rudderAnalyticsRemotePlugins';
const remotePluginsExportsFilename = `${distName}.js`;
const moduleType = process.env.MODULE_TYPE || 'cdn';
const isNpmPackageBuild = moduleType === 'npm';
const isCDNPackageBuild = moduleType === 'cdn';
const pluginsMap = {
  './BeaconQueue': './src/beaconQueue/index.ts',
  './Bugsnag': './src/bugsnag/index.ts',
  './DeviceModeDestinations': './src/deviceModeDestinations/index.ts',
  './DeviceModeTransformation': './src/deviceModeTransformation/index.ts',
  './ErrorReporting': './src/errorReporting/index.ts',
  './ExternalAnonymousId': './src/externalAnonymousId/index.ts',
  './GoogleLinker': './src/googleLinker/index.ts',
  './NativeDestinationQueue': './src/nativeDestinationQueue/index.ts',
  './OneTrustConsentManager': './src/oneTrustConsentManager/index.ts',
  './KetchConsentManager': './src/ketchConsentManager/index.ts',
  './StorageEncryption': './src/storageEncryption/index.ts',
  './StorageMigrator': './src/storageMigrator/index.ts',
  './StorageEncryptionLegacy': './src/storageEncryptionLegacy/index.ts',
  './XhrQueue': './src/xhrQueue/index.ts',
};

export function getDefaultConfig(distName) {
  const version = process.env.VERSION || 'dev-snapshot';
  const isLocalServerEnabled = isCDNPackageBuild && process.env.DEV_SERVER;

  return {
    watch: {
      include: ['src/**'],
    },
    external: [...Object.keys(pkg.peerDependencies || {})],
    onwarn(warning, warn) {
      // Silence 'this' has been rewritten to 'undefined' warning
      // https://rollupjs.org/guide/en/#error-this-is-undefined
      if (warning.code === 'THIS_IS_UNDEFINED') {
        return;
      }

      warn(warning);
    },
    plugins: [
      replace({
        preventAssignment: true,
        __PACKAGE_VERSION__: version,
        __MODULE_TYPE__: moduleType,
        __BUNDLE_ALL_PLUGINS__: isLegacyBuild,
        __RS_BUGSNAG_API_KEY__: process.env.BUGSNAG_API_KEY || '{{__RS_BUGSNAG_API_KEY__}}',
        __RS_BUGSNAG_RELEASE_STAGE__: process.env.BUGSNAG_RELEASE_STAGE || 'production',
      }),
      resolve({
        jsnext: true,
        browser: true,
        preferBuiltins: false,
        extensions: ['.js', '.ts', '.mjs'],
      }),
      nodePolyfills({
        include: ['crypto'],
      }),
      commonjs({
        include: /node_modules/,
        requireReturnsDefault: 'auto',
      }),
      json(),
      typescript({
        tsconfig: './tsconfig.json',
        useTsconfigDeclarationDir: true,
      }),
      babel({
        compact: true,
        babelHelpers: 'bundled',
        exclude: ['node_modules/@babel/**', 'node_modules/core-js/**'],
        extensions: [...DEFAULT_EXTENSIONS, '.ts'],
        sourcemap: sourceMapType,
      }),
      !isLegacyBuild && isCDNPackageBuild &&
      federation({
        name: modName,
        filename: remotePluginsExportsFilename,
        exposes: pluginsMap,
      }),
      !isLegacyBuild && isNpmPackageBuild &&
      copy({
        targets: [
          { src: 'package.json', dest: outDirNpmRoot },
          { src: 'README.md', dest: outDirNpmRoot },
          { src: 'CHANGELOG.md', dest: outDirNpmRoot },
          { src: 'LICENSE', dest: outDirNpmRoot },
        ],
      }),
      process.env.UGLIFY === 'true' &&
      terser({
        safari10: isLegacyBuild,
        ecma: isLegacyBuild ? 2015 : 2017,
        format: {
          comments: false,
        },
      }),
      filesize({
        showBeforeSizes: 'build',
        showBrotliSize: true,
      }),
      process.env.VISUALIZER === 'true' &&
      visualizer({
        filename: `./stats/${distName}.html`,
        title: `Rollup Visualizer - ${distName}`,
        sourcemap: true,
        open: true,
        gzipSize: true,
        brotliSize: true,
      }),
      isLocalServerEnabled &&
      serve({
        contentBase: ['dist'],
        host: 'localhost',
        port: 3002,
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
      }),
      isLocalServerEnabled && livereload(),
    ],
  };
}

const outputFilesNpm = [
  {
    entryFileNames: `index.js`,
    dir: outDirNpm + '/esm/',
    format: 'esm',
    name: modName,
    sourcemap: sourceMapType,
    generatedCode: {
      preset: isLegacyBuild ? 'es5' : 'es2015',
    },
  },
  {
    entryFileNames: `index.js`,
    dir: outDirNpm + '/cjs',
    format: 'cjs',
    name: modName,
    sourcemap: sourceMapType,
    generatedCode: {
      preset: isLegacyBuild ? 'es5' : 'es2015',
    },
  },
];

const outputFilesCdn = [
  {
    chunkFileNames: `${distName}-[name]${process.env.UGLIFY === 'true' ? '.min' : ''}.js`,
    dir: outDirCDN,
    format: 'esm',
    name: modName,
    sourcemap: sourceMapType,
    generatedCode: {
      preset: isLegacyBuild ? 'es5' : 'es2015',
    },
  },
];

const buildConfig = () => {
  return {
    ...getDefaultConfig(distName),
  };
};

const buildEntries = () => {
  const outputFiles = isCDNPackageBuild ? outputFilesCdn : outputFilesNpm;

  if(isCDNPackageBuild) {
    return[{
      ...buildConfig(),
      input: 'src/index.ts',
      output: outputFiles,
    }];
  }

  return [
    {
      ...buildConfig(),
      input: 'src/index.ts',
      output: outputFiles,
    },
    {
      input: `dist/dts/packages/analytics-js-plugins/src/index.d.ts`,
      plugins: [
        alias({
          entries: [
            {
              find: '@rudderstack/analytics-js-plugins',
              replacement: path.resolve('./dist/dts/packages/analytics-js-plugins/src'),
            }
          ]
        }),
        dts(),
        del({ hook: "buildEnd", targets: "./dist/dts" }),
      ],
      output: {
        file: `${outDirNpmRoot}/index.d.ts`,
        format: 'es',
      },
    }
  ];
}

export default buildEntries();