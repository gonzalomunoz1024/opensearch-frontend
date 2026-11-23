/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The colour ramps of a region map: truncatedColorMaps of the charts plugin (each of the six
 * schemas of 512 colours with its lightest quarter cut off, 384 left), as the original's
 * colorUtil.getColor reads them (each channel floored to 0..255). Taken from OpenSearch
 * Dashboards 3.9.0 as built, since its palettes come from the component library. Each ramp is
 * one string of 6-digit hex colours.
 */

const RAMPS: Record<string, string> = {
  'Blues': [
    'd8e2efd8e2efd8e2efd7e2efd7e2efd7e1eed6e1eed6e1eed6e1eed6e0eed5e0eed5e0eed5e0eed4e0edd4dfedd4dfed',
    'd3dfedd3dfedd3dfedd3deedd2deedd2deecd2deecd1ddecd1ddecd1ddecd0ddecd0ddecd0dcecd0dceccfdcebcfdceb',
    'cfdbebcedbebcedbebcedbebcddbebcddaebcddaeacddaeaccdaeaccd9eaccd9eacbd9eacbd9eacbd9eacad8e9cad8e9',
    'cad8e9cad8e9c9d8e9c9d7e9c9d7e9c8d7e9c8d7e8c8d6e8c7d6e8c7d6e8c7d6e8c7d6e8c6d5e8c6d5e8c6d5e7c5d5e7',
    'c5d5e7c5d4e7c4d4e7c4d4e7c4d4e7c4d3e7c3d3e6c3d3e6c3d3e6c2d3e6c2d2e6c2d2e6c1d2e6c1d2e6c1d1e5c1d1e5',
    'c0d1e5c0d1e5c0d1e5bfd0e5bfd0e5bfd0e5bed0e4bed0e4becfe4becfe4bdcfe4bdcfe4bdcee4bccee4bccee3bccee3',
    'bbcee3bbcde3bbcde3bacde3bacde3bacde3bacce3b9cce2b9cce2b9cce2b8cbe2b8cbe2b8cbe2b7cbe2b7cbe2b7cae1',
    'b7cae1b6cae1b6cae1b6cae1b5c9e1b5c9e1b5c9e1b4c9e0b4c8e0b4c8e0b4c8e0b3c8e0b3c8e0b3c7e0b2c7e0b2c7df',
    'b2c7dfb1c7dfb1c6dfb1c6dfb1c6dfb0c6dfb0c6dfb0c5deafc5deafc5deafc5deaec4deaec4deaec4deadc4deadc4dd',
    'adc3ddadc3ddacc3ddacc3ddacc3ddabc2ddabc2ddabc2dcaac2dcaac1dcaac1dcaac1dca9c1dca9c1dca9c0dca8c0dc',
    'a8c0dba8c0dba7c0dba7bfdba7bfdba6bfdba6bfdba6bedba6bedaa5bedaa5bedaa5bedaa4bddaa4bddaa4bddaa3bdda',
    'a3bdd9a3bcd9a2bcd9a2bcd9a2bcd9a2bcd9a1bbd9a1bbd9a1bbd8a0bbd8a0bad8a0bad89fbad89fbad89fbad89eb9d8',
    '9eb9d79eb9d79eb9d79db9d79db8d79db8d79cb8d79cb8d79cb8d69bb7d69bb7d69bb7d69ab7d69ab7d69ab6d69ab6d6',
    '99b6d599b6d599b5d598b5d598b5d598b5d597b5d597b4d597b4d496b4d496b4d496b4d496b3d495b3d495b3d495b3d4',
    '94b3d494b2d394b2d393b2d393b2d393b1d392b1d392b1d392b1d391b1d291b0d291b0d290b0d290b0d290b0d290afd2',
    '8fafd28fafd18fafd18eafd18eaed18eaed18daed18daed18daed18cadd08cadd08cadd08badd08bacd08bacd08bacd0',
    '8aacd08aaccf8aabcf89abcf89abcf89abcf88abcf88aacf88aacf87aace87aace87aace86a9ce86a9ce86a9ce85a9ce',
    '85a9ce85a8cd84a8cd84a8cd84a8cd84a8cd83a7cd83a7cd83a7cd82a7cd82a7cc82a6cc81a6cc81a6cc81a6cc80a5cc',
    '80a5cc80a5cc7fa5cb7fa5cb7fa4cb7ea4cb7ea4cb7ea4cb7da4cb7da3cb7da3ca7ca3ca7ca3ca7ca3ca7ba2ca7ba2ca',
    '7ba2ca7aa2ca7aa2c97aa1c97aa1c979a1c979a1c979a1c978a0c978a0c978a0c877a0c877a0c8779fc8769fc8769fc8',
    '769fc8759ec8759ec7759ec7749ec7749ec7749dc7739dc7739dc7739dc7729dc6729cc6729cc6719cc6719cc6719cc6',
    '709bc6709bc6709bc66f9bc56f9bc56f9ac56e9ac56e9ac56e9ac56d9ac56d99c56d99c46c99c46c99c46b99c46b98c4',
    '6b98c46b98c46a98c46a98c36997c36997c36997c36897c36897c36896c36796c36796c26796c26696c26695c26695c2',
    '6595c26595c26595c26494c16494c16494c16394c16394c16393c16293c16293c16193c06193c06192c06092c06092c0',
  ].join(''),
  'Greens': [
    'cce3decce3ddcbe3ddcbe3ddcae2dccae2dccae2dcc9e2dcc9e2dbc8e1dbc8e1dbc8e1dbc7e1dac7e1dac6e0dac6e0da',
    'c6e0d9c5e0d9c5dfd9c4dfd9c4dfd8c4dfd8c3dfd8c3ded8c2ded7c2ded7c2ded7c1ded7c1ddd6c0ddd6c0ddd6c0ddd6',
    'bfdcd5bfdcd5bfdcd5bedcd5bedcd4bddbd4bddbd4bddbd4bcdbd3bcdbd3bbdad3bbdad3bbdad2badad2bad9d2b9d9d2',
    'b9d9d1b9d9d1b8d9d1b8d8d1b7d8d0b7d8d0b7d8d0b6d8d0b6d7cfb5d7cfb5d7cfb5d7cfb4d6ceb4d6ceb3d6ceb3d6cd',
    'b3d6cdb2d5cdb2d5cdb1d5ccb1d5ccb1d5ccb0d4ccb0d4cbafd4cbafd4cbafd3cbaed3caaed3caaed3caadd3caadd2c9',
    'acd2c9acd2c9acd2c9abd2c8abd1c8aad1c8aad1c8aad1c7a9d0c7a9d0c7a8d0c7a8d0c6a8d0c6a7cfc6a7cfc6a6cfc5',
    'a6cfc5a6cfc5a5cec5a5cec4a4cec4a4cec4a4cec4a3cdc3a3cdc3a2cdc3a2cdc3a2ccc2a1ccc2a1ccc2a0ccc2a0ccc1',
    'a0cbc19fcbc19fcbc19ecbc09ecbc09ecac09dcac09dcabf9ccabf9cc9bf9cc9bf9bc9be9bc9be9ac9be9ac8be9ac8bd',
    '99c8bd99c8bd98c8bd98c7bc98c7bc97c7bc97c7bc96c6bb96c6bb96c6bb95c6bb95c6ba94c5ba94c5ba94c5ba93c5b9',
    '93c5b992c4b992c4b992c4b991c4b891c4b890c3b890c3b890c3b78fc3b78fc2b78ec2b78ec2b68ec2b68dc2b68dc1b6',
    '8cc1b58cc1b58cc1b58bc1b58bc0b48ac0b48ac0b48ac0b489bfb389bfb388bfb388bfb388bfb287beb287beb286beb2',
    '86beb186beb185bdb185bdb184bdb084bdb083bdb083bcb083bcaf82bcaf82bcaf81bbaf81bbae81bbae80bbae80bbae',
    '7fbaad7fbaad7fbaad7ebaad7ebaac7db9ac7db9ac7db9ac7cb9ab7cb8ab7bb8ab7bb8ab7ab8ab7ab8aa7ab7aa79b7aa',
    '79b7aa78b7a978b7a978b6a977b6a977b6a876b6a876b6a875b5a875b5a775b5a774b5a774b4a773b4a673b4a673b4a6',
    '72b4a672b3a571b3a571b3a570b3a570b3a470b2a46fb2a46fb2a46eb2a36eb1a36db1a36db1a36db1a36cb1a26cb0a2',
    '6bb0a26bb0a26bb0a16ab0a16aafa169afa169afa068afa068afa068aea067ae9f67ae9f66ae9f66ad9f65ad9e65ad9e',
    '64ad9e64ad9e64ac9d63ac9d63ac9d62ac9d62ac9c61ab9c61ab9c61ab9c60ab9c60aa9b5faa9b5faa9b5eaa9b5eaa9a',
    '5da99a5da99a5da99a5ca9995ca9995ba8995ba8995aa8985aa89859a89859a79858a79758a79758a79757a69757a697',
    '56a69656a69655a69655a59654a59554a59553a59553a59552a49452a49452a49451a49451a49350a39350a3934fa393',
    '4fa3924ea2924ea2924da2924da2924ca2914ca1914ba1914ba1914aa1904aa19049a09049a09048a08f48a08f47a08f',
    '479f8f469f8e469f8e459f8e459e8e449e8e449e8d439e8d439e8d429d8d429d8c419d8c419d8c409d8c409c8b3f9c8b',
    '3f9c8b3e9c8b3d9b8a3d9b8a3c9b8a3c9b8a3b9b8a3b9a893a9a893a9a89399a89389a88389988379988379988369987',
    '3699873598873498873498863398863397863297863197863197853097852f96852f96852e96842d96842d96842c9584',
    '2b95832b95832a9583299583299483289482279482269482269382259381249381239381239381229280219280209280',
  ].join(''),
  'Greys': [
    'c2c9d3c2c8d3c2c8d3c1c7d2c1c7d2c0c6d2c0c6d1bfc6d1bfc5d0bfc5d0bec4d0bec4cfbdc4cfbdc3cfbcc3cebcc2ce',
    'bbc2cdbbc2cdbbc1cdbac1ccbac0ccb9c0ccb9bfcbb8bfcbb8bfcab8becab7becab7bdc9b6bdc9b6bdc9b5bcc8b5bcc8',
    'b5bbc7b4bbc7b4bbc7b3bac6b3bac6b2b9c6b2b9c5b2b9c5b1b8c4b1b8c4b0b7c4b0b7c3b0b6c3afb6c3afb6c2aeb5c2',
    'aeb5c1adb4c1adb4c1adb4c0acb3c0acb3bfabb2bfabb2bfaab2beaab1beaab1bea9b0bda9b0bda8b0bca8afbca8afbc',
    'a7aebba7aebba6aebaa6adbaa6adbaa5acb9a5acb9a4acb9a4abb8a3abb8a3aab7a3aab7a2a9b7a2a9b6a1a9b6a1a8b5',
    'a1a8b5a0a7b5a0a7b49fa7b49fa6b49fa6b39ea5b39ea5b29da5b29da4b29da4b19ca3b19ca3b09ba3b09ba2b09aa2af',
    '9aa1af9aa1ae99a1ae99a0ae98a0ad989fad989fad979fac979eac969eab969dab969dab959daa959caa949ca9949ca9',
    '949ba9939ba8939aa8929aa79299a79299a79199a69198a69198a69098a59097a58f97a48f96a48f96a48e96a38e95a3',
    '8d95a28d94a28d94a28c94a18c93a18b93a08b92a08b92a08a929f8a919f89919e89909e89909e88909d888f9d888f9c',
    '878e9c878e9c868e9b868d9b868d9b858c9a858c9a848c99848b99848b99838b98838a98838a97828997828997818996',
    '8188968188958087958087958087947f86947f86937e85937e85937e85927d84927d84917c84917c83917c83907b8290',
    '7b82907b828f7a818f7a818e79808e79808e79808d787f8d787f8c787f8c777e8c777e8b777d8b767d8a767d8a757c8a',
    '757c89757b89747b88747b88747a88737a87737a87727987727986727886717885717885717785707784707784707683',
    '6f76836f75836e75826e75826e74816d74816d74816d73806c73806c727f6c727f6b727f6b717e6a717e6a717d6a707d',
    '69707d696f7c696f7c686f7c686e7b686e7b676e7a676d7a666d7a666c79666c79656c78656b78656b78646a77646a77',
    '646a776369766369766369756268756268756268746167746167736066736066736066725f65725f65715f65715e6471',
    '5e64705e63705d63705d636f5d626f5c626e5c626e5c616e5b616d5b606d5b606c5a606c5a5f6c595f6b595f6b595e6a',
    '585e6a585e6a585d69575d69575c69575c68565c68565b67565b67555b67555a66555a66545a66545965545965535864',
    '5358645358645257635257635257625156625156625156615055615055615055604f54604f545f4f535f4e535f4e535e',
    '4e525e4d525e4d525d4d515d4c515c4c515c4c505c4b505b4b505b4b4f5b4a4f5a4a4e5a4a4e59494e59494d59494d58',
    '484d58484c58484c57474c57474b56474b56464b56464a55464a55454a55454954454954444854444853444853434752',
    '43475243475242465142465142465141455041455041454f40444f40444f40444e3f434e3f434e3f434d3e424d3e424d',
    '3e424c3d414c3d414b3d404b3d404b3c404a3c3f4a3c3f4a3b3f493b3e493b3e493a3e483a3d483a3d47393d47393c47',
    '393c46383c46383b46383b45373b45373a45373a44373a44363944363943363943353842353842353842343741343741',
  ].join(''),
  'Reds': [
    'f9d4ccf9d4ccf9d4cbf9d3cbf9d3cbf9d3caf8d2caf8d2c9f8d2c9f8d1c9f8d1c8f8d1c8f8d0c7f8d0c7f8d0c7f8cfc6',
    'f8cfc6f8cfc6f8cec5f8cec5f7cec4f7cdc4f7cdc4f7cdc3f7ccc3f7ccc2f7ccc2f7cbc2f7cbc1f7cbc1f7cac1f7cac0',
    'f7cac0f7c9bff6c9bff6c9bff6c8bef6c8bef6c8bdf6c8bdf6c7bdf6c7bcf6c7bcf6c6bcf6c6bbf6c6bbf5c5baf5c5ba',
    'f5c5baf5c4b9f5c4b9f5c4b9f5c3b8f5c3b8f5c3b7f5c2b7f5c2b7f5c2b6f5c1b6f4c1b5f4c1b5f4c0b5f4c0b4f4c0b4',
    'f4bfb4f4bfb3f4bfb3f4beb2f4beb2f4beb2f3bdb1f3bdb1f3bdb1f3bcb0f3bcb0f3bcaff3bbaff3bbaff3bbaef3baae',
    'f3baaef3baadf2b9adf2b9acf2b9acf2b8acf2b8abf2b8abf2b8abf2b7aaf2b7aaf2b7a9f2b6a9f1b6a9f1b6a8f1b5a8',
    'f1b5a8f1b5a7f1b4a7f1b4a6f1b4a6f1b3a6f1b3a5f0b3a5f0b2a5f0b2a4f0b2a4f0b1a3f0b1a3f0b1a3f0b0a2f0b0a2',
    'f0b0a2efafa1efafa1efafa0efaea0efaea0efae9fefad9fefad9fefad9eefac9eefac9deeac9deeab9deeab9ceeab9c',
    'eeaa9ceeaa9beeaa9beeaa9aeea99aeda99aeda999eda899eda899eda898eda798eda798eda797eda697eda696eca696',
    'eca596eca595eca595eca495eca494eca494eca393eca393eba393eba292eba292eba292eba191eba191eba191eba090',
    'eba090eaa08fea9f8fea9f8fea9f8eea9e8eea9e8eea9e8dea9d8dea9d8de99d8ce99d8ce99c8be99c8be99c8be99b8a',
    'e99b8ae99b8ae99a89e89a89e89a89e89988e89988e89987e89887e89887e89886e89786e79786e79785e79685e79685',
    'e79684e79584e79583e79583e69483e69482e69482e69382e69381e69381e69281e69280e59280e59180e5917fe5917f',
    'e5907ee5907ee5907ee58f7de58f7de48f7de48f7ce48e7ce48e7ce48e7be48d7be48d7be48d7ae38c7ae38c79e38c79',
    'e38b79e38b78e38b78e38a78e38a77e28a77e28977e28976e28976e28876e28875e28875e18774e18774e18774e18673',
    'e18673e18673e18572e18572e08572e08471e08471e08471e08370e08370e08370e0826fdf826fdf826edf816edf816e',
    'df816ddf806ddf806dde806cde7f6cde7f6cde7f6bde7e6bde7e6bde7e6add7d6add7d6add7d69dd7d69dd7c69dd7c68',
    'dd7c68dd7b67dc7b67dc7b67dc7a66dc7a66dc7a66dc7965dc7965db7965db7864db7864db7864db7763db7763db7763',
    'da7662da7662da7662da7561da7561da7561da7460d97460d9745fd9735fd9735fd9735ed9725ed9725ed8725dd8715d',
    'd8715dd8715cd8705cd8705cd8705bd76f5bd76f5bd76f5ad76e5ad76e5ad76e59d76d59d66d59d66d58d66c58d66c58',
    'd66c57d66b57d66b57d56b56d56a56d56a56d56a55d56955d56955d46954d46854d46853d46853d46753d46752d46752',
    'd36652d36651d36651d36551d36550d36450d26450d2644fd2634fd2634fd2634ed2624ed2624ed1624dd1614dd1614d',
    'd1614cd1604cd1604cd0604bd05f4bd05f4bd05f4ad05e4ad05e4ad05e49cf5d49cf5d49cf5d48cf5c48cf5c48cf5c47',
    'ce5b47ce5b47ce5b46ce5a46ce5a46ce5a45cd5945cd5945cd5844cd5844cd5844cd5743cc5743cc5743cc5642cc5642',
  ].join(''),
  'Yellow to Red': [
    'ff7e0cff7e0cff7e0cff7e0cff7e0cff7e0cff7d0dff7d0dff7d0dff7d0dff7d0dff7d0dff7c0dff7c0dff7c0dff7c0d',
    'ff7c0eff7b0eff7b0eff7b0eff7b0eff7b0eff7b0eff7a0eff7a0eff7a0eff7a0eff7a0fff7a0fff790fff790fff790f',
    'ff790fff790fff780fff780fff780fff780fff7810ff7810ff7710ff7710ff7710ff7710ff7710ff7710ff7610ff7610',
    'ff7611ff7611ff7611ff7511ff7511ff7511ff7511ff7511ff7511ff7411ff7411ff7412ff7412ff7412ff7412ff7312',
    'ff7312ff7312ff7312ff7312ff7212ff7213ff7213ff7213ff7213ff7213ff7113ff7113ff7113ff7113ff7113ff7113',
    'ff7014ff7014ff7014ff7014ff7014ff6f14ff6f14ff6f14ff6f14ff6f14ff6f14ff6e15ff6e15ff6e15ff6e15ff6e15',
    'ff6e15ff6d15ff6d15ff6d15ff6d15ff6d16ff6c16ff6c16ff6c16ff6c16ff6c16ff6c16ff6b16ff6b16ff6b16ff6b16',
    'ff6b17ff6b17ff6a17ff6a17ff6a17ff6a17ff6a17ff6917ff6917ff6917ff6917ff6918ff6918ff6818ff6818ff6818',
    'ff6818ff6818ff6818ff6718ff6718ff6719ff6719ff6719ff6719ff6619ff6619ff6619ff6619ff6619ff6519ff6519',
    'ff651aff651aff651aff651aff641aff641aff641aff641aff641aff641aff631aff631bff631bff631bff631bff621b',
    'ff621bff621bff621bff621bff621bff611cff611cff611cff611cff611cff611cff601cff601cff601cff601cff601c',
    'ff5f1dff5f1dff5f1dff5f1dff5f1dff5f1dff5e1dff5e1dff5e1dff5e1dff5e1dff5e1eff5d1eff5d1eff5d1eff5d1e',
    'ff5d1eff5c1eff5c1eff5c1eff5c1eff5c1fff5c1fff5b1fff5b1fff5b1fff5b1fff5b1fff5b1fff5a1fff5a1fff5a1f',
    'ff5a20ff5a20ff5920ff5920ff5920ff5920ff5920ff5920ff5820ff5820ff5821ff5821ff5821ff5821ff5721ff5721',
    'ff5721ff5721ff5721ff5621ff5621ff5622ff5622ff5622ff5622ff5522ff5522ff5522ff5522ff5522ff5522ff5422',
    'ff5423ff5423ff5423ff5423ff5323ff5323ff5323ff5323ff5323ff5323ff5224ff5224ff5224ff5224ff5224ff5224',
    'ff5124ff5124ff5124ff5124ff5124ff5025ff5025ff5025ff5025ff5025ff5025ff4f25ff4f25ff4f25ff4f25ff4f25',
    'ff4f26ff4e26ff4e26ff4e26ff4e26ff4e26ff4d26ff4d26ff4d26ff4d26ff4d27ff4d27ff4c27ff4c27ff4c27ff4c27',
    'ff4c27ff4c27ff4b27ff4b27ff4b27ff4b28ff4b28ff4a28ff4a28ff4a28ff4a28ff4a28ff4a28ff4928ff4928ff4928',
    'ff4929ff4929ff4929ff4829ff4829ff4829ff4829ff4829ff4829ff4729ff472aff472aff472aff472aff462aff462a',
    'ff462aff462aff462aff462aff452aff452bff452bff452bff452bff452bff442bff442bff442bff442bff442bff432b',
    'ff432cff432cff432cff432cff432cff422cff422cff422cff422cff422cff422dff412dff412dff412dff412dff412d',
    'ff402dff402dff402dff402dff402dff402eff3f2eff3f2eff3f2eff3f2eff3f2eff3f2eff3e2eff3e2eff3e2eff3e2e',
    'ff3e2fff3d2fff3d2fff3d2fff3d2fff3d2fff3d2fff3c2fff3c2fff3c2fff3c30ff3c30ff3c30ff3b30ff3b30ff3b30',
  ].join(''),
  'Green to Red': [
    '9aae2c9aae2c9bae2c9cad2b9dad2b9ead2b9ead2a9fad2aa0ac2aa1ac29a2ac29a2ac29a3ac28a4ab28a5ab28a6ab27',
    'a6ab27a7ab26a8aa26a9aa26aaaa25aaaa25abaa25aca924ada924aea924aea923afa923b0a823b1a822b2a822b2a822',
    'b3a821b4a721b5a721b6a720b6a720b7a720b8a71fb9a61fb9a61ebaa61ebba61ebca61dbda51dbda51dbea51cbfa51c',
    'c0a51cc1a41bc1a41bc2a41bc3a41ac4a41ac5a31ac5a319c6a319c7a319c8a318c9a218c9a218caa217cba217cca216',
    'cda116cda116cea115cfa115d0a115d1a014d1a014d2a014d3a013d4a013d49f13d59f12d69f12d79f12d89f11d89e11',
    'd99e11da9e10db9e10dc9e10dc9e0fdd9d0fde9d0edf9d0ee09d0ee09d0de19c0de29c0de39c0ce49c0ce49c0ce59b0b',
    'e69b0be79b0be89b0ae89b0ae99a0aea9a09eb9a09ec9a09ec9a08ed9908ee9907ef9907f09907f09906f19806f29806',
    'f39805f39805f49805f59704f69704f79704f79703f89703f99603fa9602fb9602fb9602fc9601fd9501fe9501ff9500',
    'ff9500ff9400ff9400ff9401ff9301ff9301ff9301ff9201ff9202ff9202ff9102ff9102ff9102ff9003ff9003ff9003',
    'ff8f03ff8f03ff8e03ff8e04ff8e04ff8d04ff8d04ff8d04ff8c05ff8c05ff8c05ff8b05ff8b05ff8b06ff8a06ff8a06',
    'ff8a06ff8906ff8906ff8807ff8807ff8807ff8707ff8707ff8708ff8608ff8608ff8608ff8508ff8509ff8509ff8409',
    'ff8409ff8409ff8309ff830aff830aff820aff820aff810aff810bff810bff800bff800bff800bff7f0cff7f0cff7f0c',
    'ff7e0cff7e0cff7e0cff7d0dff7d0dff7d0dff7c0dff7c0dff7b0eff7b0eff7b0eff7a0eff7a0eff7a0fff790fff790f',
    'ff790fff780fff780fff7810ff7710ff7710ff7710ff7610ff7611ff7511ff7511ff7511ff7411ff7412ff7412ff7312',
    'ff7312ff7312ff7213ff7213ff7213ff7113ff7113ff7113ff7014ff7014ff6f14ff6f14ff6f14ff6e15ff6e15ff6e15',
    'ff6d15ff6d15ff6d16ff6c16ff6c16ff6c16ff6b16ff6b16ff6b17ff6a17ff6a17ff6917ff6917ff6918ff6818ff6818',
    'ff6818ff6718ff6719ff6719ff6619ff6619ff6619ff6519ff651aff651aff641aff641aff641aff631bff631bff621b',
    'ff621bff621bff611cff611cff611cff601cff601cff601cff5f1dff5f1dff5f1dff5e1dff5e1dff5e1eff5d1eff5d1e',
    'ff5c1eff5c1eff5c1fff5b1fff5b1fff5b1fff5a1fff5a1fff5a20ff5920ff5920ff5920ff5820ff5821ff5821ff5721',
    'ff5721ff5621ff5622ff5622ff5522ff5522ff5522ff5422ff5423ff5423ff5323ff5323ff5323ff5224ff5224ff5224',
    'ff5124ff5124ff5025ff5025ff5025ff4f25ff4f25ff4f25ff4e26ff4e26ff4e26ff4d26ff4d26ff4d27ff4c27ff4c27',
    'ff4c27ff4b27ff4b28ff4a28ff4a28ff4a28ff4928ff4928ff4929ff4829ff4829ff4829ff4729ff472aff472aff462a',
    'ff462aff462aff452bff452bff452bff442bff442bff432bff432cff432cff422cff422cff422cff412dff412dff412d',
    'ff402dff402dff402eff3f2eff3f2eff3f2eff3e2eff3e2eff3d2fff3d2fff3d2fff3c2fff3c2fff3c30ff3b30ff3b30',
  ].join(''),
};

/** The schemas, in the order the editor lists them */
export const TRUNCATED_COLOR_SCHEMAS: Array<{ value: string; text: string }> = [{ value:'Blues', text:'Blues' }, { value:'Greens', text:'Greens' }, { value:'Greys', text:'Greys' }, { value:'Reds', text:'Reds' }, { value:'Yellow to Red', text:'Yellow to Red' }, { value:'Green to Red', text:'Green to Red' }];

const cache = new Map<string, string[]>();

/** The colours of a schema, as `rgb(r,g,b)` texts; undefined for a schema that does not exist */
export function truncatedColorRamp(schema: string): string[] | undefined {
  const packed = RAMPS[schema];
  if (packed === undefined) return undefined;
  let colors = cache.get(schema);
  if (!colors) {
    colors = [];
    for (let i = 0; i < packed.length; i += 6) {
      const n = (at: number) => parseInt(packed.slice(i + at, i + at + 2), 16);
      colors.push(`rgb(${n(0)},${n(2)},${n(4)})`);
    }
    cache.set(schema, colors);
  }
  return colors;
}
