#!/usr/bin/env node

const commander = require('commander')
const path = require('path')
const chalk = require('chalk')
const semver = require('semver')
const spawn = require('cross-spawn')
const execSync = require('child_process').execSync
const fs = require('fs-extra')
const dns = require('dns')
const url = require('url')
const ora = require('ora')
const envinfo = require('envinfo')

const packageJson = require('./package.json')

const templateRepository = packageJson.template.repository

let projectName

const program = new commander.Command(packageJson.name)
    .version(packageJson.version)
    .arguments('<project-directory>')
    .usage(`${chalk.green('<project-directory>')} [options]`)
    .action(name => {
        projectName = name
    })
    .option('--verbose', 'print additional logs')
    .option('--info', 'print environment debug info')
    .option('--use-npm')
    .allowUnknownOption()
    .on('--help', () => {
        console.log(`    Only ${chalk.green('<project-directory>')} is required.`);
        console.log();
        console.log(
            `    If you have any problems, do not hesitate to file an issue:`
        );
        console.log(
            `      ${chalk.cyan(
                'https://github.com/react-fast-cli/react-fast-cli/issues/new'
            )}`
        );
        console.log();
    })
    .parse(process.argv)


if (typeof projectName === 'undefined') {
    if (program.info) {
        envinfo.print({
            packages: ['react', 'react-dom', 'antd'],
            noNativeIDE: true,
            duplicates: true,
        })
        process.exit(0)
    }
    console.error('Please specify the project directory: ')
    console.log(
        `  ${chalk.cyan(program.name())} ${chalk.green('<project-directory>')}`
    )
    console.log()
    console.log('For example:')
    console.log(`  ${chalk.cyan(program.name())} ${chalk.green('test-react-app')}`)
    console.log()
    console.log(
        `Run ${chalk.cyan(`${program.name()} --help`)} to see all options.`
    );
    process.exit(1)
}

create(projectName, program.useNpm, program.verbose)

function create(name, useNpm, verbose) {
    const root = path.resolve(name)
    const appName = path.basename(root)
    fs.ensureDirSync(name)

    console.log(`creating a new react + redux + antd project in ${chalk.green(root)}`)
    console.log()

    const useYarn = useNpm ? false : hasYarn()
    const originalDir = process.cwd()
    process.chdir(root)
    if (!useYarn && !checkThatNpmCanReadCwd()) {
        process.exit(1)
    }

    if (!semver.satisfies(process.version, '>=6.0.0')) {
        console.log(
            chalk.yellow(
                `当前的 node 版本低于 6.0, 升级到更高版本获得更好的体验`
            )
        )
    }
    run(root, appName, originalDir, useYarn, verbose)
}

function run(root, appName, originalDirectory, useYarn, verbose) {
    cloneRepo(root).then(_ => {
        const p = {
            name: appName,
            version: '0.1.0',
            description: '',
            private: true
        }
        const packageJsonPath = path.join(root, 'package.json')
        const packageJson = require(packageJsonPath)
        const assignPackageJson = Object.assign({}, packageJson, p)
        fs.writeFileSync(
            path.join(root, 'package.json'),
            JSON.stringify(assignPackageJson, null, 2)
        )
        checkIfOnline(useYarn).then(isOnline => {
            install(root, useYarn, isOnline, verbose)
        })
    }).catch(error => {
        console.log(chalk.red(`clone 模版库失败, 请检查网络`))
        console.log()
    })
}

function cloneRepo(root) {
    const spinner = ora('')
    spinner.start()
    console.log()

    return new Promise((resolve, rejct) => {
        command = 'git'
        args = [
            'clone'
        ].concat([
            templateRepository,
            root
        ])

        const child = spawn(command, args, { stdio: 'inherit' })
        child.on('close', code => {
            if (code !== 0) {
                reject({
                    command: `${command} ${args.join(' ')}`,
                })
                spinner.fail('clone template failed')
                return
            }
            spinner.succeed('clone template succeed')
            resolve()
        })
    })
}

function install(root, useYarn, isOnline, verbose) {
    return new Promise((resolve, reject) => {
        let command
        let args
        if (useYarn) {
            command = 'yarnpkg';
            args = ['install']
            if (!isOnline) {
                args.push('--offline')
            }
            [].push.apply(args)

            // yarn --cwd
            // npm --prefix but checkThatNpmCanReadCwd() early instead.
            args.push('--cwd')
            args.push(root)

            if (!isOnline) {
                console.log(chalk.yellow('你似乎处于离线状态'))
                console.log(chalk.yellow('请清除 yarn cache'))
                console.log()
            }
        } else {
            command = 'npm'
            args = ['install']
            args.push('--prefix')
            args.push(root)
            if (verbose) {
                args.push('--verbose');
            }
        }

        const child = spawn(command, args, { stdio: 'inherit' })
        child.on('close', code => {
            if (code !== 0) {
                reject({
                    command: `${command} ${args.join(' ')}`,
                });
                return
            }
            resolve()
        })
    })
}

function hasYarn() {
    try {
        execSync('yarnpkg --version', { stdio: 'ignore' })
        return true
    } catch (e) {
        return false
    }
}

function checkThatNpmCanReadCwd() {
    const cwd = process.cwd()
    let childOutput = null
    try {
        // 检查 npm 是否能读取该路径
        childOutput = spawn.sync('npm', ['config', 'list']).output.join('')
    } catch (err) {
        return true
    }
    if (typeof childOutput !== 'string') {
        return true
    }
    const lines = childOutput.split('\n')
    // `npm config list` output includes: 
    // ; cwd = /Users/userName/git/react-cli
    const prefix = '; cwd = '
    const line = lines.find(line => line.indexOf(prefix) === 0)
    if (typeof line !== 'string') {
        // 未读取到
        return true
    }
    const npmCWD = line.substring(prefix.length);
    if (npmCWD === cwd) {
        return true
    }
    console.error(
        chalk.red(
            `Could not start an npm process in the right directory.\n\n` +
            `The current directory is: ${chalk.bold(cwd)}\n` +
            `However, a newly started npm process runs in: ${chalk.bold(
                npmCWD
            )}\n\n` +
            `This is probably caused by a misconfigured system terminal shell.`
        )
    )
    if (process.platform === 'win32') {
        console.error(
            chalk.red(`On Windows, this can usually be fixed by running:\n\n`) +
            `  ${chalk.cyan(
                'reg'
            )} delete "HKCU\\Software\\Microsoft\\Command Processor" /v AutoRun /f\n` +
            `  ${chalk.cyan(
                'reg'
            )} delete "HKLM\\Software\\Microsoft\\Command Processor" /v AutoRun /f\n\n` +
            chalk.red(`Try to run the above two lines in the terminal.\n`) +
            chalk.red(
                `To learn more about this problem, read: https://blogs.msdn.microsoft.com/oldnewthing/20071121-00/?p=24433/`
            )
        )
    }
    return false
}

function getProxy() {
    if (process.env.https_proxy) {
        return process.env.https_proxy
    } else {
        try {
            // read https-proxy from .npmrc
            let httpsProxy = execSync('npm config get https-proxy')
                .toString()
                .trim()
            return httpsProxy !== 'null' ? httpsProxy : undefined
        } catch (e) {
            return
        }
    }
}

function checkIfOnline(useYarn) {
    if (!useYarn) {
        // Don't ping the Yarn registry.
        // We'll just assume the best case.
        return Promise.resolve(true)
    }

    return new Promise(resolve => {
        dns.lookup('registry.yarnpkg.com', err => {
            let proxy
            if (err != null && (proxy = getProxy())) {
                // If a proxy is defined, we likely can't resolve external hostnames.
                // Try to resolve the proxy name as an indication of a connection.
                dns.lookup(url.parse(proxy).hostname, proxyErr => {
                    resolve(proxyErr == null);
                });
            } else {
                resolve(err == null);
            }
        });
    });
}
